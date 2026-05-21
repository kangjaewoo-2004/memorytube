"use client";

import { CheckCircle2, FileText, Link as LinkIcon, Loader2, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type SavePhase = "idle" | "saving" | "transcript" | "summary" | "needs_transcript" | "complete";

type SaveVideoResponse = {
  duplicate?: boolean;
  error?: string;
  message?: string;
  stage?: string;
  step?: string;
  details?: unknown;
  video?: {
    id?: string;
    status?: string;
  };
};

const steps = [
  {
    id: "saving",
    label: "링크 저장",
    description: "YouTube 주소와 기본 정보를 기억 저장소에 담고 있어요.",
    icon: LinkIcon
  },
  {
    id: "transcript",
    label: "자막 확인",
    description: "공개 자막을 찾고, 없으면 직접 붙여넣을 수 있게 안내해요.",
    icon: FileText
  },
  {
    id: "summary",
    label: "AI 요약",
    description: "자막을 요약하고 키워드와 검색용 기억 조각을 만들어요.",
    icon: Sparkles
  }
] as const;

export function AddVideoForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [manualTranscript, setManualTranscript] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState<SavePhase>("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);
    setPhase("saving");
    const timers = [
      window.setTimeout(() => setPhase("transcript"), 600),
      window.setTimeout(() => setPhase("summary"), 1600)
    ];

    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, manualTranscript })
      });
      const data = await readSaveVideoResponse(response);

      if (!response.ok) {
        throw new Error(formatApiError(data, response.status));
      }

      if (!data.video?.id) {
        throw new Error(
          formatApiError(
            {
              step: "response_missing_video_id",
              message: "Video save response did not include a video id.",
              details: data
            },
            response.status
          )
        );
      }

      timers.forEach((timer) => window.clearTimeout(timer));
      setUrl("");
      setManualTranscript("");
      setPhase(data.video?.status === "needs_transcript" ? "needs_transcript" : "complete");

      if (data.duplicate) {
        setMessage("이미 저장된 영상이에요. 기존 기억으로 이동합니다.");
      } else if (data.video?.status === "needs_transcript") {
        setMessage("공개 자막을 찾지 못했어요. 다음 화면에서 transcript를 직접 붙여넣으면 요약할 수 있어요.");
      } else {
        setMessage("요약까지 완료했어요. 저장된 기억으로 이동합니다.");
      }

      await wait(550);
      try {
        router.push(`/videos/${data.video.id}`);
        router.refresh();
      } catch (error) {
        console.error("[MemoryTube dashboard refresh failed]", error);
        throw new Error(
          formatApiError(
            {
              step: "dashboard_refresh_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Dashboard refresh failed after saving the video.",
              details: { videoId: data.video.id }
            },
            response.status
          )
        );
      }
    } catch (error) {
      console.error("[MemoryTube video save UI error]", error);
      setMessage(error instanceof Error ? error.message : "Could not save video.");
      setPhase("idle");
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
      setIsLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="sticky top-20 rounded-lg border border-line bg-white p-5 shadow-soft"
    >
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-mint">
          새 기억
        </p>
        <h2 className="mt-1 text-xl font-semibold">YouTube 링크 저장</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          링크를 붙여넣으면 자막을 찾고, 가능한 경우 AI가 바로 요약해요.
        </p>
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="youtube-url">
          YouTube URL
        </label>
        <input
          id="youtube-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          placeholder="https://www.youtube.com/watch?v=..."
          className="mt-2 h-11 w-full rounded-md border border-line bg-paper px-3 text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
        />
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="manual-transcript">
          Transcript 직접 붙여넣기
        </label>
        <p className="mt-1 text-xs leading-5 text-neutral-500">
          선택 사항이에요. 자막이 없는 영상이라면 여기 붙여넣으면 바로 요약할 수 있어요.
        </p>
        <textarea
          id="manual-transcript"
          value={manualTranscript}
          onChange={(event) => setManualTranscript(event.target.value)}
          rows={8}
          placeholder="영상 자막을 알고 있다면 여기에 붙여넣기"
          className="mt-2 w-full resize-y rounded-md border border-line bg-paper px-3 py-3 text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
        />
      </div>

      {isLoading || phase === "complete" || phase === "needs_transcript" ? (
        <div className="mt-4 space-y-2 rounded-md border border-line bg-paper p-3">
          {steps.map((step) => {
            const Icon = step.icon;
            const state = getStepState(phase, step.id);

            return (
              <div key={step.id} className="flex gap-3">
                <span
                  className={[
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                    state === "done"
                      ? "border-mint bg-mint text-white"
                      : state === "active"
                        ? "border-ink bg-white text-ink"
                        : "border-line bg-white text-neutral-400"
                  ].join(" ")}
                >
                  {state === "done" ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : state === "active" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">{step.label}</p>
                  <p className="text-xs leading-5 text-neutral-500">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {message ? (
        <p className="mt-4 whitespace-pre-wrap rounded-md border border-line bg-paper px-3 py-2 text-sm leading-6 text-neutral-700">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isLoading}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="h-4 w-4" aria-hidden="true" />
        )}
        {isLoading ? "기억 저장 중" : "영상 기억하기"}
      </button>
    </form>
  );
}

function getStepState(phase: SavePhase, stepId: (typeof steps)[number]["id"]) {
  const currentIndex = steps.findIndex((step) => step.id === phase);
  const stepIndex = steps.findIndex((step) => step.id === stepId);

  if (phase === "complete" || phase === "needs_transcript") {
    return stepId === "summary" && phase === "needs_transcript" ? "idle" : "done";
  }

  if (currentIndex === stepIndex) {
    return "active";
  }

  if (currentIndex > stepIndex) {
    return "done";
  }

  return "idle";
}

async function readSaveVideoResponse(response: Response): Promise<SaveVideoResponse> {
  const text = await response.text();

  if (!text) {
    return {
      step: "empty_response",
      message: `Server returned HTTP ${response.status} with an empty response.`
    };
  }

  try {
    return JSON.parse(text) as SaveVideoResponse;
  } catch {
    return {
      step: "non_json_response",
      message: `Server returned HTTP ${response.status} with a non-JSON response.`,
      details: { bodyPreview: text.slice(0, 500) }
    };
  }
}

function formatApiError(data: SaveVideoResponse, status: number) {
  const step = data.step || data.stage || "unknown_step";
  const message = data.message || data.error || `Request failed with HTTP ${status}.`;
  const lines = [`Step: ${step}`, `Message: ${message}`];

  if (data.details !== undefined) {
    lines.push(`Details: ${formatDetails(data.details)}`);
  }

  return lines.join("\n");
}

function formatDetails(details: unknown) {
  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
