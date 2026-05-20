import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/env";
import {
  answerQuestion,
  prepareChatContexts,
  type ChatContext,
  type ChatHistoryMessage
} from "@/lib/openai";
import { logOpenAIUsage } from "@/lib/openai-usage";
import { searchRelevantChunks } from "@/lib/rag";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type QuestionType = "overview" | "topic" | "follow_up" | "memory";
type RetrievalMode = "vector" | "summaries" | "summary-filter" | "memory-summaries";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
    }

    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as {
      question?: string;
      history?: ChatHistoryMessage[];
    };
    const question = body.question?.trim();
    const history = sanitizeHistory(body.history);

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const questionType = classifyQuestion(question, history);
    const retrievalQuery = buildRetrievalQuery(question, history);
    let contexts: ChatContext[] = [];

    logQuestionDebug(question, questionType, retrievalQuery);

    if (questionType === "overview" || questionType === "memory") {
      contexts = await loadSummaryContexts(supabase, user.id);
      logRetrievalDebug(
        question,
        retrievalQuery,
        contexts,
        questionType === "memory" ? "memory-summaries" : "summaries",
        questionType
      );
    } else {
      try {
        const chunks = await searchRelevantChunks(supabase, user.id, retrievalQuery, {
          matchCount: 16,
          threshold: questionType === "follow_up" ? 0.3 : 0.35
        });
        contexts = chunks.map(mapChunkToContext);
        logRetrievalDebug(question, retrievalQuery, contexts, "vector", questionType);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[MemoryTube RAG] Vector search failed.", error);
        }
      }

      if (contexts.length === 0 && questionType === "follow_up") {
        contexts = await loadSummaryContexts(supabase, user.id);
        logRetrievalDebug(question, retrievalQuery, contexts, "summaries", questionType);
      }

      if (contexts.length === 0 && questionType === "topic") {
        contexts = await loadRelevantSummaryContexts(supabase, user.id, question);
        logRetrievalDebug(
          question,
          retrievalQuery,
          contexts,
          "summary-filter",
          questionType
        );
      }
    }

    contexts = prepareChatContexts(contexts);
    logContextAssembly(contexts, questionType);

    if (contexts.length === 0) {
      logNoContext(question, questionType);

      return NextResponse.json({
        answer:
          "저장된 영상 데이터에서 이 질문에 답할 만큼 관련 있는 내용을 찾지 못했습니다.",
        sources: []
      });
    }

    const chatResult = await answerQuestion(question, contexts, history, {
      questionType
    });
    await logOpenAIUsage(supabase, {
      userId: user.id,
      feature: "chat_answer",
      model: chatResult.model,
      inputSizeEstimate: chatResult.inputSizeEstimate,
      outputSizeEstimate: chatResult.outputSizeEstimate
    });
    const sources = uniqueSources(contexts, questionType);

    return NextResponse.json({ answer: chatResult.answer, sources });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not answer question." },
      { status: 500 }
    );
  }
}

async function loadSummaryContexts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data } = await supabase
    .from("videos")
    .select("id,title,youtube_url,created_at,summaries(summary,keywords)")
    .eq("user_id", userId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(12);

  return (data || []).map((video) => {
    const summary = firstRelation(video.summaries);
    const keywords = Array.isArray(summary?.keywords) ? summary.keywords : [];
    const keywordText = keywords.length ? `Keywords: ${keywords.join(", ")}` : "";

    return {
      video_id: video.id,
      title: video.title || "Untitled YouTube video",
      youtube_url: video.youtube_url,
      created_at: video.created_at,
      source_type: "summary" as const,
      content: [`Video summary:\n${summary?.summary || ""}`, keywordText]
        .filter(Boolean)
        .join("\n"),
      summary: summary?.summary || null,
      keywords,
      similarity: null
    };
  });
}

async function loadRelevantSummaryContexts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  question: string
) {
  const summaries = await loadSummaryContexts(supabase, userId);
  const terms = extractQueryTerms(question);

  if (terms.length === 0) {
    return [];
  }

  return summaries
    .map((context) => ({
      context,
      score: scoreSummaryContext(context, terms)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => ({
      ...item.context,
      similarity: item.score / Math.max(terms.length, 1)
    }));
}

function mapChunkToContext(chunk: Record<string, unknown>): ChatContext {
  return {
    video_id: String(chunk.video_id),
    title: String(chunk.title || "Untitled YouTube video"),
    youtube_url: String(chunk.youtube_url || ""),
    content: String(chunk.content || chunk.summary || ""),
    summary: typeof chunk.summary === "string" ? chunk.summary : null,
    keywords: Array.isArray(chunk.keywords)
      ? chunk.keywords.map((keyword) => String(keyword))
      : [],
    similarity: typeof chunk.similarity === "number" ? Number(chunk.similarity) : null,
    created_at: typeof chunk.created_at === "string" ? chunk.created_at : null,
    source_type: "chunk"
  };
}

function uniqueSources(contexts: ChatContext[], questionType: QuestionType) {
  const sources = new Map<string, { video_id: string; title: string; youtube_url: string }>();
  const maxSources = questionType === "memory" ? 5 : contexts.length;
  const orderedContexts =
    questionType === "memory" ? rankMemorySourceContexts(contexts) : contexts;

  for (const context of orderedContexts) {
    if (!sources.has(context.video_id)) {
      sources.set(context.video_id, {
        video_id: context.video_id,
        title: context.title,
        youtube_url: context.youtube_url
      });
    }
  }

  return Array.from(sources.values()).slice(0, maxSources);
}

function rankMemorySourceContexts(contexts: ChatContext[]) {
  return [...contexts].sort((a, b) => {
    return getMemorySourceScore(b) - getMemorySourceScore(a);
  });
}

function getMemorySourceScore(context: ChatContext) {
  const keywordScore = Math.min(context.keywords?.length || 0, 6) * 2;
  const contentScore = Math.min(context.content.length / 220, 6);
  const hasUsefulSummary = context.content.length > 180 ? 3 : 0;
  const shortPenalty = context.content.length < 120 ? -3 : 0;
  const dateScore = context.created_at ? Date.parse(context.created_at) / 1_000_000_000_000 : 0;

  return keywordScore + contentScore + hasUsefulSummary + shortPenalty + dateScore;
}

function sanitizeHistory(history: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((message): message is ChatHistoryMessage => {
      return (
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        "content" in message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 1200)
    }))
    .filter((message) => message.content.length > 0)
    .slice(-6);
}

function buildRetrievalQuery(question: string, history: ChatHistoryMessage[]) {
  const recentHistory = history
    .slice(-4)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [recentHistory, `user: ${question}`].filter(Boolean).join("\n");
}

function classifyQuestion(
  question: string,
  history: ChatHistoryMessage[]
): QuestionType {
  if (isFollowUpQuestion(question, history)) {
    return "follow_up";
  }

  if (isMemoryQuestion(question)) {
    return "memory";
  }

  if (isOverviewQuestion(question)) {
    return "overview";
  }

  return "topic";
}

function isFollowUpQuestion(question: string, history: ChatHistoryMessage[]) {
  if (history.length === 0) {
    return false;
  }

  return /(방금|앞에서|위에서|그걸|그거|그 내용|이 내용|더 쉽게|다시 설명|이어)/iu.test(
    question
  );
}

function isMemoryQuestion(question: string) {
  return /(관심|관심사|취향|패턴|소비|최근|요즘|반복|비중|경향|트렌드|공통점|공통적으로|추천|다시\s*볼|공부|배우|학습|좋을까|내가.*좋아|interests?|patterns?|recent|trend|common themes?|recommend|study|learn)/iu.test(
    question
  );
}

function isOverviewQuestion(question: string) {
  return /(전체|모든|저장한 영상|저장 영상|내가 저장한|공통점|공통적으로|반복되는 주제|관심사|핵심 정리|전체 핵심|요약해줘|추천해줘|다시 볼만한)/iu.test(
    question
  );
}

function extractQueryTerms(question: string) {
  const stopWords = new Set([
    "관련",
    "영상",
    "영상만",
    "영상들",
    "정리",
    "정리해줘",
    "알려줘",
    "요약",
    "요약해줘",
    "저장한",
    "저장",
    "내가",
    "내",
    "전체",
    "공통점",
    "추천",
    "추천해줘",
    "about",
    "only",
    "video",
    "videos"
  ]);

  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !stopWords.has(term));
}

function scoreSummaryContext(context: ChatContext, terms: string[]) {
  const haystack = [
    context.title,
    context.summary,
    context.content,
    context.keywords?.join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return terms.reduce((score, term) => {
    return haystack.includes(term) ? score + 1 : score;
  }, 0);
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function logQuestionDebug(
  question: string,
  questionType: QuestionType,
  retrievalQuery: string
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.log(
    "[MemoryTube RAG question]",
    JSON.stringify({ question, questionType, retrievalQuery }, null, 2)
  );
}

function logRetrievalDebug(
  question: string,
  retrievalQuery: string,
  contexts: ChatContext[],
  mode: RetrievalMode,
  questionType: QuestionType
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.log(
    "[MemoryTube RAG]",
    JSON.stringify(
      {
        mode,
        questionType,
        question,
        retrievalQuery,
        contextCount: contexts.length,
        chunks: contexts.map((context, index) => ({
          rank: index + 1,
          videoId: context.video_id,
          title: context.title,
          sourceType: context.source_type,
          createdAt: context.created_at,
          similarity: context.similarity,
          keywords: context.keywords,
          preview: context.content.slice(0, 220)
        })),
        contextPreview: contexts
          .map((context, index) => {
            const score =
              typeof context.similarity === "number"
                ? `score=${context.similarity.toFixed(3)}`
                : "score=n/a";
            return `#${index + 1} ${score} ${context.title}: ${context.content.slice(0, 260)}`;
          })
          .join("\n\n")
      },
      null,
      2
    )
  );
}

function logContextAssembly(contexts: ChatContext[], questionType: QuestionType) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.log(
    "[MemoryTube RAG context]",
    JSON.stringify(
      {
        questionType,
        contextCount: contexts.length,
        sentToModel: contexts.map((context, index) => ({
          rank: index + 1,
          videoId: context.video_id,
          title: context.title,
          sourceType: context.source_type,
          createdAt: context.created_at,
          similarity: context.similarity,
          keywords: context.keywords,
          length: context.content.length,
          preview: context.content.slice(0, 260)
        }))
      },
      null,
      2
    )
  );
}

function logNoContext(question: string, questionType: QuestionType) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.log(
    "[MemoryTube RAG no-context]",
    JSON.stringify(
      {
        question,
        questionType,
        reason:
          questionType === "topic"
            ? "No vector chunks or summary terms matched the specific topic."
            : "No ready video summaries were available."
      },
      null,
      2
    )
  );
}
