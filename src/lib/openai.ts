import OpenAI from "openai";

import {
  getOpenAIChatModel,
  getOpenAIEmbeddingModel,
  getOpenAISummaryModel
} from "@/lib/env";
import {
  clipTextByChars,
  estimateTokens,
  OPENAI_SAFETY
} from "@/lib/openai-safety";

let openai: OpenAI | null = null;

type MinimalChatCompletion = {
  choices: Array<{ message?: { content?: string | null } }>;
};

type MinimalEmbeddingResponse = {
  data: Array<{ embedding?: number[] }>;
};

export type SummaryResult = {
  summary: string;
  keywords: string[];
  model?: string;
  inputSizeEstimate?: number;
  outputSizeEstimate?: number;
};

export type ChatContext = {
  video_id: string;
  title: string;
  youtube_url: string;
  content: string;
  summary?: string | null;
  keywords?: string[] | null;
  similarity?: number | null;
  created_at?: string | null;
  source_type?: "chunk" | "summary";
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatAnswerResult = {
  answer: string;
  model: string;
  inputSizeEstimate: number;
  outputSizeEstimate: number;
};

type ChatAnswerOptions = {
  questionType?: "overview" | "topic" | "follow_up" | "memory";
};

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openai;
}

export async function summarizeTranscript(title: string, transcript: string) {
  const client = getClient();
  const model = getOpenAISummaryModel();
  const clippedTranscript = clipTextByChars(
    transcript,
    OPENAI_SAFETY.maxTranscriptChars,
    "Transcript"
  );
  const inputText = `Title: ${title || "Untitled video"}\n\nTranscript:\n${clippedTranscript}`;
  const inputSizeEstimate = estimateTokens(inputText);
  let response: MinimalChatCompletion;

  try {
    response = await client.chat.completions.create({
      model,
      max_tokens: OPENAI_SAFETY.summaryMaxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You summarize YouTube transcripts for a personal memory app. Return only valid JSON with keys summary and keywords. Summary should be concise but useful. Keywords should be 4 to 8 short tags."
        },
        {
          role: "user",
          content: inputText
        }
      ]
    });
  } catch (error) {
    throwOpenAIRequestError("summary", error);
  }

  const raw = response.choices[0]?.message?.content || "{}";
  const parsed = parseSummaryJson(raw);

  if (!parsed.summary) {
    throw new Error("OpenAI did not return a usable summary.");
  }

  return {
    ...parsed,
    model,
    inputSizeEstimate,
    outputSizeEstimate: estimateTokens(raw)
  };
}

export async function embedText(text: string) {
  const client = getClient();
  const model = getOpenAIEmbeddingModel();
  const clippedText = clipTextByChars(
    text,
    OPENAI_SAFETY.maxEmbeddingInputChars,
    "Embedding input"
  );
  let response: MinimalEmbeddingResponse;

  try {
    response = await client.embeddings.create({
      model,
      input: clippedText
    });
  } catch (error) {
    throwOpenAIRequestError("embedding", error);
  }

  const embedding = response.data[0]?.embedding;

  if (!embedding) {
    throw new Error("OpenAI did not return an embedding.");
  }

  return embedding;
}

export function prepareChatContexts(contexts: ChatContext[]) {
  const selected: ChatContext[] = [];
  const seen = new Set<string>();
  const perVideoCount = new Map<string, number>();
  let totalTokens = 0;

  const sorted = [...contexts].sort((a, b) => {
    return (b.similarity ?? 0) - (a.similarity ?? 0);
  });

  for (const context of sorted) {
    const content = normalizeContextText(context.content);
    const videoCount = perVideoCount.get(context.video_id) || 0;
    const key = `${context.video_id}:${content.slice(0, 360).toLowerCase()}`;

    if (!content || seen.has(key) || videoCount >= 3) {
      continue;
    }

    const clippedContent = clipText(content, 1800);
    const contextTokens = estimateTokens(clippedContent);

    if (totalTokens + contextTokens > OPENAI_SAFETY.maxChatContextTokens) {
      break;
    }

    selected.push({
      ...context,
      content: clippedContent
    });
    seen.add(key);
    perVideoCount.set(context.video_id, videoCount + 1);
    totalTokens += contextTokens;

    if (selected.length >= OPENAI_SAFETY.maxChatChunks) {
      break;
    }
  }

  return selected;
}

export async function answerQuestion(
  question: string,
  contexts: ChatContext[],
  history: ChatHistoryMessage[] = [],
  options: ChatAnswerOptions = {}
): Promise<ChatAnswerResult> {
  const client = getClient();
  const model = getOpenAIChatModel();
  const preparedContexts = prepareChatContexts(contexts);
  const memoryProfile = buildMemoryProfile(preparedContexts);
  const memoryInstructions = buildMemoryInstructions(options.questionType);
  logMemoryPromptDebug(preparedContexts, memoryProfile, options.questionType);
  const sourceText = preparedContexts
    .map((context, index) => {
      const keywords = context.keywords?.length
        ? `Keywords: ${context.keywords.join(", ")}`
        : "";
      const similarity =
        typeof context.similarity === "number"
          ? `Similarity: ${context.similarity.toFixed(3)}`
          : "";
      const savedAt = context.created_at ? `Saved at: ${context.created_at}` : "";
      const sourceType = context.source_type
        ? `Context type: ${context.source_type}`
        : "";

      return [
        `Source ${index + 1}`,
        `Video ID: ${context.video_id}`,
        `Title: ${context.title}`,
        `URL: ${context.youtube_url}`,
        savedAt,
        sourceType,
        similarity,
        keywords,
        `Saved data: ${context.content}`
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
  const historyText = history
    .slice(-OPENAI_SAFETY.maxChatHistoryMessages)
    .map(
      (message) =>
        `${message.role}: ${clipText(
          message.content,
          OPENAI_SAFETY.maxChatHistoryMessageChars
        )}`
    )
    .join("\n");
  const userContent = [
    historyText ? `Conversation history:\n${historyText}` : "",
    `Question intent:\n${options.questionType || "topic"}`,
    memoryInstructions ? `Memory-style answer rules:\n${memoryInstructions}` : "",
    `Latest question:\n${question}`,
    memoryProfile ? `Memory profile from saved videos:\n${memoryProfile}` : "",
    `Saved video context, sorted by relevance:\n${sourceText}`
  ]
    .filter(Boolean)
    .join("\n\n");
  let response: MinimalChatCompletion;

  try {
    response = await client.chat.completions.create({
      model,
      max_tokens: OPENAI_SAFETY.chatMaxOutputTokens,
      messages: [
        {
          role: "system",
          content:
            [
              "You are MemoryTube, an AI assistant that remembers and understands the user's saved YouTube videos.",
              "Answer only from the provided saved video context and the conversation history.",
              "Use conversation history to understand follow-up questions, but do not invent facts that are not grounded in the saved video context.",
              "For cross-video, interest, pattern, or recommendation questions, synthesize across multiple saved videos instead of describing one search result.",
              "Use titles, summaries, keywords, and saved dates to identify repeated themes and recent interests.",
              "When describing the user's interests, frame them as observations or inferences from saved videos, not certain facts about the user.",
              "Avoid overconfident wording such as 'the user is interested in X'; prefer cautious wording like 'based on saved videos, X appears to be a recurring signal.'",
              "Prefer recent saved videos when the question asks about current or recent interests, and distinguish recent signals from older ones when dates are available.",
              "For interest or pattern claims, briefly name the supporting video title or keyword signal.",
              "If context is weak, missing, or only loosely related, say that honestly.",
              "Prefer clear structured answers with short bullet points when useful.",
              "Ground claims by naming the source video titles naturally.",
              "Do not add a separate Sources section because the app renders sources below the answer.",
              "Reply in the same language as the user's latest question."
            ].join(" ")
        },
        {
          role: "user",
          content: userContent
        }
      ]
    });
  } catch (error) {
    throwOpenAIRequestError("chat", error);
  }

  const answer =
    response.choices[0]?.message?.content?.trim() ||
    "I could not answer from the saved video data.";

  return {
    answer,
    model,
    inputSizeEstimate: estimateTokens(userContent),
    outputSizeEstimate: estimateTokens(answer)
  };
}

function buildMemoryInstructions(questionType: ChatAnswerOptions["questionType"]) {
  if (questionType !== "memory") {
    return "";
  }

  return [
    "Use a cautious memory-assistant tone. Treat interests as inferences from saved videos, not facts about the person.",
    "For Korean answers, always include these five section labels exactly: 한 줄 결론, 근거, 반복되는 주제, 최근 변화, 다시 볼 만한 영상.",
    "For other languages, use equivalent headings: one-line conclusion, evidence, recurring themes, recent shift, videos worth revisiting.",
    "In the conclusion, say '저장한 영상 기준으로 보면' or a similar cautious phrase.",
    "Under evidence, mention the video title or keyword that supports each inference.",
    "Mention at most 3-5 specific video titles in the answer, and choose the strongest evidence rather than listing every saved video.",
    "If the context has only 1 or 2 saved videos, state that there is not enough data for a reliable pattern and keep the analysis short.",
    "If there is no clear recent change, say that the saved dates do not show a clear change instead of forcing one.",
    "Do not claim external knowledge or browsing. Use only the saved video context."
  ].join("\n");
}

function parseSummaryJson(raw: string): SummaryResult {
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryResult>;
    return {
      summary: String(parsed.summary || "").trim(),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords
            .map((keyword) => String(keyword).trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 8)
        : []
    };
  } catch {
    return { summary: "", keywords: [] };
  }
}

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function buildMemoryProfile(contexts: ChatContext[]) {
  const videos = uniqueVideoContexts(contexts);

  if (videos.length === 0) {
    return "";
  }

  const datedVideos = [...videos]
    .filter((context) => Boolean(context.created_at))
    .sort((a, b) => {
      return Date.parse(b.created_at || "") - Date.parse(a.created_at || "");
    });
  const recentVideos = datedVideos.slice(0, 4);
  const olderVideos = datedVideos.slice(4);
  const keywordCounts = countKeywords(videos);
  const recentKeywordCounts = countKeywords(recentVideos);
  const repeatedKeywords = Array.from(keywordCounts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topKeywords = Array.from(keywordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const recentKeywords = Array.from(recentKeywordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const evidenceVideos = rankMemoryEvidenceVideos(videos).slice(0, 5);
  const lines = [`Context covers ${videos.length} saved video(s).`];

  if (videos.length <= 2) {
    lines.push(
      "There are only 1-2 saved videos in this context, so pattern or interest analysis should be brief and cautious."
    );
  }

  if (recentVideos.length > 0) {
    lines.push(
      `Most recent saved videos: ${recentVideos
        .map((video) => `${formatDate(video.created_at)} - ${video.title}`)
        .join("; ")}.`
    );
  }

  if (olderVideos.length > 0) {
    lines.push(
      `Older saved videos in this context: ${olderVideos
        .slice(0, 4)
        .map((video) => `${formatDate(video.created_at)} - ${video.title}`)
        .join("; ")}.`
    );
  }

  if (repeatedKeywords.length > 0) {
    lines.push(
      `Repeated keyword signals: ${repeatedKeywords
        .map(([keyword, count]) => `${keyword} (${count})`)
        .join(", ")}.`
    );
  } else if (topKeywords.length > 0) {
    lines.push(
      `Available keyword signals are broad, so interest inference should be cautious: ${topKeywords
        .map(([keyword, count]) => `${keyword} (${count})`)
        .join(", ")}.`
    );
  }

  if (recentKeywords.length > 0) {
    lines.push(
      `Recent keyword signals: ${recentKeywords
        .map(([keyword, count]) => `${keyword} (${count})`)
        .join(", ")}.`
    );
  }

  lines.push(
    `Strongest evidence videos: ${evidenceVideos
      .map((video) => {
        const keywords = video.keywords?.length
          ? `keywords: ${video.keywords.slice(0, 5).join(", ")}`
          : "keywords: none";

        return `${formatDate(video.created_at)} - ${video.title} (${keywords})`;
      })
      .join("; ")}.`
  );

  return lines.join("\n");
}

function rankMemoryEvidenceVideos(contexts: ChatContext[]) {
  return [...contexts].sort((a, b) => {
    return getMemoryEvidenceScore(b) - getMemoryEvidenceScore(a);
  });
}

function getMemoryEvidenceScore(context: ChatContext) {
  const keywordScore = Math.min(context.keywords?.length || 0, 6) * 2;
  const contentScore = Math.min(context.content.length / 220, 6);
  const hasUsefulSummary = context.content.length > 180 ? 3 : 0;
  const shortPenalty = context.content.length < 120 ? -3 : 0;
  const dateScore = context.created_at ? Date.parse(context.created_at) / 1_000_000_000_000 : 0;

  return keywordScore + contentScore + hasUsefulSummary + shortPenalty + dateScore;
}

function uniqueVideoContexts(contexts: ChatContext[]) {
  const videos = new Map<string, ChatContext>();

  for (const context of contexts) {
    const previous = videos.get(context.video_id);

    if (!previous) {
      videos.set(context.video_id, context);
      continue;
    }

    videos.set(context.video_id, {
      ...previous,
      summary: previous.summary || context.summary,
      keywords: mergeKeywords(previous.keywords, context.keywords),
      created_at: previous.created_at || context.created_at
    });
  }

  return Array.from(videos.values());
}

function countKeywords(contexts: ChatContext[]) {
  const counts = new Map<string, number>();

  for (const context of contexts) {
    for (const keyword of context.keywords || []) {
      const normalized = keyword.trim().toLowerCase();

      if (normalized.length < 2) {
        continue;
      }

      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  return counts;
}

function mergeKeywords(
  first: string[] | null | undefined,
  second: string[] | null | undefined
) {
  return Array.from(new Set([...(first || []), ...(second || [])]));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "unknown date";
  }

  return value.slice(0, 10);
}

function logMemoryPromptDebug(
  contexts: ChatContext[],
  memoryProfile: string,
  questionType: ChatAnswerOptions["questionType"]
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.log(
    "[MemoryTube memory prompt]",
    JSON.stringify(
      {
        questionType,
        contextCount: contexts.length,
        memoryProfile,
        videos: uniqueVideoContexts(contexts).map((context) => ({
          videoId: context.video_id,
          title: context.title,
          savedAt: context.created_at,
          keywords: context.keywords,
          sourceType: context.source_type
        }))
      },
      null,
      2
    )
  );
}

function clipText(text: string, maxLength: number) {
  return clipTextByChars(text, maxLength, "Text");
}

function throwOpenAIRequestError(feature: string, error: unknown): never {
  const detail = error instanceof Error ? error.message : "Unknown OpenAI error";

  throw new Error(
    `OpenAI ${feature} request failed. Check OPENAI_API_KEY, model settings, billing status, and input size. Details: ${detail}`
  );
}
