import type { SupabaseClient } from "@supabase/supabase-js";

import { getOpenAIEmbeddingModel } from "@/lib/env";
import { embedText } from "@/lib/openai";
import { estimateTokens } from "@/lib/openai-safety";
import { logOpenAIUsage } from "@/lib/openai-usage";

const RETRIEVAL_CANDIDATES = 14;
const TOP_K_CONTEXTS = 8;
const SIMILARITY_THRESHOLD = 0.35;
const TARGET_CHUNK_LENGTH = 1200;
const MAX_CHUNK_LENGTH = 1600;
const MAX_CHUNKS_PER_VIDEO = 32;
const OVERLAP_UNITS = 2;

type StoreVideoChunksInput = {
  userId: string;
  videoId: string;
  transcript: string;
  summary: string;
};

export type RetrievedChunk = {
  id?: string;
  video_id: string;
  title: string | null;
  youtube_url: string | null;
  created_at: string | null;
  content: string;
  summary: string | null;
  keywords: string[] | null;
  similarity: number;
};

export async function storeVideoChunks(
  supabase: SupabaseClient,
  input: StoreVideoChunksInput
) {
  const chunks = splitIntoChunks(input.summary, input.transcript);
  const model = getOpenAIEmbeddingModel();

  await supabase.from("video_chunks").delete().eq("video_id", input.videoId);

  const rows = [];

  for (const chunk of chunks) {
    const embedding = await embedText(chunk);
    await logOpenAIUsage(supabase, {
      userId: input.userId,
      feature: "video_chunk_embedding",
      model,
      inputSizeEstimate: estimateTokens(chunk),
      outputSizeEstimate: 0
    });
    rows.push({
      user_id: input.userId,
      video_id: input.videoId,
      content: chunk,
      embedding: vectorLiteral(embedding)
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("video_chunks").insert(rows);
    if (error) {
      throw error;
    }
  }
}

export async function searchRelevantChunks(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  options: { matchCount?: number; threshold?: number } = {}
) {
  const embedding = await embedText(query);
  await logOpenAIUsage(supabase, {
    userId,
    feature: "chat_query_embedding",
    model: getOpenAIEmbeddingModel(),
    inputSizeEstimate: estimateTokens(query),
    outputSizeEstimate: 0
  });

  const { data, error } = await supabase.rpc("match_video_chunks", {
    query_embedding: vectorLiteral(embedding),
    match_user_id: userId,
    match_count: options.matchCount || RETRIEVAL_CANDIDATES
  });

  if (error) {
    throw error;
  }

  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;

  return dedupeRetrievedChunks((data || []) as RetrievedChunk[])
    .filter((chunk) => chunk.similarity >= threshold)
    .slice(0, TOP_K_CONTEXTS);
}

function splitIntoChunks(summary: string, transcript: string) {
  // TODO: Replace this fixed-size chunker with token-aware splitting as usage grows.
  const chunks: string[] = [];
  const normalizedSummary = normalizeText(summary);
  const units = splitIntoMeaningUnits(transcript);

  if (normalizedSummary) {
    chunks.push(`Video summary:\n${clipChunk(normalizedSummary)}`);
  }

  let current: string[] = [];
  let currentLength = 0;

  for (const unit of units) {
    if (currentLength > 0 && currentLength + unit.length > TARGET_CHUNK_LENGTH) {
      chunks.push(formatTranscriptChunk(current));
      current = current.slice(-OVERLAP_UNITS);
      currentLength = current.join(" ").length;
    }

    current.push(unit);
    currentLength += unit.length + 1;

    if (currentLength >= MAX_CHUNK_LENGTH) {
      chunks.push(formatTranscriptChunk(current));
      current = current.slice(-OVERLAP_UNITS);
      currentLength = current.join(" ").length;
    }
  }

  if (current.length > 0) {
    chunks.push(formatTranscriptChunk(current));
  }

  return uniqueTexts(chunks)
    .map(clipChunk)
    .filter((chunk) => chunk.trim().length > 40)
    .slice(0, MAX_CHUNKS_PER_VIDEO);
}

function splitIntoMeaningUnits(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(normalizeText)
    .filter(Boolean);
  const rawUnits = paragraphs.length > 1 ? paragraphs : [normalizeText(text)];
  const units: string[] = [];

  for (const rawUnit of rawUnits) {
    const sentenceParts = rawUnit
      .split(/(?<=[.!?])\s+/)
      .map(normalizeText)
      .filter(Boolean);

    for (const sentence of sentenceParts) {
      if (sentence.length <= 520) {
        units.push(sentence);
        continue;
      }

      for (let start = 0; start < sentence.length; start += 420) {
        units.push(sentence.slice(start, start + 520).trim());
      }
    }
  }

  return units;
}

function formatTranscriptChunk(units: string[]) {
  return `Transcript excerpt:\n${units.join(" ")}`;
}

function clipChunk(text: string) {
  return text.length <= MAX_CHUNK_LENGTH
    ? text
    : `${text.slice(0, MAX_CHUNK_LENGTH)}...`;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function uniqueTexts(texts: string[]) {
  const seen = new Set<string>();
  return texts.filter((text) => {
    const key = normalizeText(text).slice(0, 300).toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeRetrievedChunks(chunks: RetrievedChunk[]) {
  const seen = new Set<string>();

  return chunks
    .filter((chunk) => chunk.content?.trim())
    .sort((a, b) => b.similarity - a.similarity)
    .filter((chunk) => {
      const contentKey = normalizeText(chunk.content).slice(0, 360).toLowerCase();
      const key = `${chunk.video_id}:${contentKey}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function vectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}
