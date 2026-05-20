"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import { FormEvent, useRef, useState } from "react";

type Source = {
  video_id: string;
  title: string;
  youtube_url: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

const exampleQuestions = [
  "내가 요즘 관심 있는 주제 뭐야?",
  "내 저장 영상들 공통점 알려줘",
  "최근 저장 패턴 분석해줘",
  "나중에 다시 볼만한 영상 추천해줘",
  "내가 뭘 공부하면 좋을까?"
];

export function ChatInterface() {
  const formRef = useRef<HTMLFormElement>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();

    await sendQuestion(trimmed);
  }

  async function sendQuestion(rawQuestion: string) {
    const trimmed = rawQuestion.trim();

    if (!trimmed || isLoading) {
      return;
    }

    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setQuestion("");
    setError("");
    setIsLoading(true);

    try {
      const history = messages
        .slice(-6)
        .map(({ role, content }) => ({ role, content }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not answer question.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources
        }
      ]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not answer question.");
    } finally {
      setIsLoading(false);
      formRef.current?.querySelector("textarea")?.focus();
    }
  }

  return (
    <div className="flex min-h-[560px] flex-1 flex-col rounded-lg border border-line bg-white shadow-soft">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-72 flex-col justify-center rounded-lg border border-dashed border-line bg-paper p-6">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-white text-mint shadow-soft">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="mx-auto mt-4 max-w-lg text-center">
              <h2 className="text-xl font-semibold">저장한 영상에게 물어보세요</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                MemoryTube는 저장된 영상의 요약, 키워드, transcript를 바탕으로만 답해요.
                아래 질문을 눌러 바로 시작할 수 있습니다.
              </p>
            </div>
            <div className="mx-auto mt-5 grid w-full max-w-lg gap-2">
              {exampleQuestions.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={isLoading}
                  onClick={() => sendQuestion(example)}
                  className="rounded-md border border-line bg-white px-3 py-2 text-left text-sm text-neutral-700 hover:border-mint hover:text-ink disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[82%] rounded-lg bg-ink px-4 py-3 text-sm leading-6 text-white"
                  : "max-w-[88%] rounded-lg border border-line bg-paper px-4 py-3 text-sm leading-6 text-neutral-800"
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.sources?.length ? (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Sources
                  </p>
                  <div className="mt-2 space-y-2">
                    {message.sources.map((source) => (
                      <a
                        key={source.video_id}
                        href={`/videos/${source.video_id}`}
                        className="block rounded-md bg-white px-3 py-2 text-xs font-medium text-mint hover:text-ink"
                      >
                        {source.title}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}

        {isLoading ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper px-4 py-3 text-sm text-neutral-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Thinking
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mx-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex items-end gap-3 border-t border-line p-4"
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          placeholder="Ask about saved videos..."
          className="min-h-12 flex-1 resize-none rounded-md border border-line bg-paper px-3 py-3 text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
        />
        <button
          type="submit"
          disabled={isLoading || !question.trim()}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-ink text-white disabled:cursor-not-allowed disabled:opacity-70"
          aria-label="Send"
          title="Send"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </form>
    </div>
  );
}
