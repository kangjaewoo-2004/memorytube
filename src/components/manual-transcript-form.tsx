"use client";

import { Loader2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type ManualTranscriptResponse = {
  error?: string;
  stage?: string;
};

export function ManualTranscriptForm({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);

    try {
      const response = await fetch(`/api/videos/${videoId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript })
      });
      const data = (await response.json().catch(() => ({
        error: `Server returned ${response.status} without a JSON error body.`
      }))) as ManualTranscriptResponse;

      if (!response.ok) {
        throw new Error(formatApiError(data.error || "Could not summarize transcript.", data.stage));
      }

      setTranscript("");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not summarize transcript."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-line bg-paper p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-mint">
        Manual transcript
      </p>
      <h2 className="mt-1 text-lg font-semibold">자막 붙여넣기</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-600">
        YouTube 공개 자막을 찾지 못한 영상은 transcript를 직접 넣으면 같은 방식으로 요약하고 저장할 수 있어요.
      </p>
      <textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        required
        rows={10}
        placeholder="영상 transcript를 여기에 붙여넣기"
        className="mt-3 w-full resize-y rounded-md border border-line bg-white px-3 py-3 text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
      />

      {message ? (
        <p className="mt-3 rounded-md border border-line bg-white px-3 py-2 text-sm text-neutral-700">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isLoading}
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Wand2 className="h-4 w-4" aria-hidden="true" />
        )}
        {isLoading ? "요약 중" : "요약해서 저장"}
      </button>
    </form>
  );
}

function formatApiError(message: string, stage?: string) {
  return stage ? `[${stage}] ${message}` : message;
}
