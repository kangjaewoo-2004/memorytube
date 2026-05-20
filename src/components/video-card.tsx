import { ExternalLink } from "lucide-react";
import Link from "next/link";

type VideoCardProps = {
  video: {
    id: string;
    title: string | null;
    thumbnail_url: string | null;
    youtube_url: string;
    status: string;
    error_message: string | null;
    created_at?: string | null;
    summaries?: Array<{ summary: string | null; keywords: string[] | null }> | null;
  };
};

const statusLabels: Record<string, string> = {
  ready: "요약 완료",
  needs_transcript: "자막 필요",
  error: "확인 필요",
  processing: "분석 중"
};

const statusStyles: Record<string, string> = {
  ready: "border-mint/30 bg-mint/10 text-mint",
  needs_transcript: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-red-200 bg-red-50 text-red-700",
  processing: "border-line bg-paper text-neutral-600"
};

export function VideoCard({ video }: VideoCardProps) {
  const summaryRow = firstRelation(video.summaries);
  const summary = summaryRow?.summary;
  const keywords = summaryRow?.keywords || [];

  return (
    <article className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
      <Link href={`/videos/${video.id}`} className="block">
        <div className="aspect-video bg-neutral-100">
          {video.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnail_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="line-clamp-2 text-base font-semibold">
              {video.title || "Untitled YouTube video"}
            </h2>
            <span
              className={[
                "shrink-0 rounded-full border px-2 py-1 text-xs font-medium",
                statusStyles[video.status] || statusStyles.processing
              ].join(" ")}
            >
              {statusLabels[video.status] || video.status}
            </span>
          </div>
          {video.created_at ? (
            <p className="mt-2 text-xs text-neutral-500">
              저장됨 {video.created_at.slice(0, 10)}
            </p>
          ) : null}

          {summary ? (
            <div className="mt-4 rounded-md bg-paper p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Summary
              </p>
              <p className="mt-2 line-clamp-4 text-sm leading-6 text-neutral-700">
                {summary}
              </p>
            </div>
          ) : video.error_message ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
              {video.error_message}
            </p>
          ) : video.status === "needs_transcript" ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
              공개 자막을 찾지 못했어요. 상세 화면에서 transcript를 붙여넣으면 요약할 수 있어요.
            </p>
          ) : null}

          {keywords.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Keywords
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {keywords.slice(0, 5).map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-line bg-white px-2 py-1 text-xs text-neutral-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Link>
      <a
        href={video.youtube_url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between border-t border-line px-4 py-3 text-sm font-medium text-mint hover:text-ink"
      >
        Open YouTube
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </article>
  );
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
