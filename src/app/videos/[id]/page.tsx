import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ManualTranscriptForm } from "@/components/manual-transcript-form";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function VideoDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: video, error } = await supabase
    .from("videos")
    .select("*,transcripts(id,content,source),summaries(summary,keywords)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !video) {
    notFound();
  }

  const transcript = firstRelation<{
    id: string;
    content: string;
    source: string;
  }>(video.transcripts);
  const summary = firstRelation<{
    summary: string;
    keywords: string[] | null;
  }>(video.summaries);
  const keywords: string[] = Array.isArray(summary?.keywords)
    ? summary.keywords
    : [];
  const visualNotes =
    typeof video.visual_notes === "string" ? video.visual_notes.trim() : "";

  return (
    <article className="mx-auto w-full max-w-4xl">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        저장소로 돌아가기
      </Link>

      <div className="mt-5 overflow-hidden rounded-lg border border-line bg-white shadow-soft">
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

        <div className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-mint">
                {getStatusLabel(video.status)}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                {video.title || "Untitled YouTube video"}
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                저장됨 {String(video.created_at || "").slice(0, 10) || "날짜 없음"}
              </p>
            </div>
            <a
              href={video.youtube_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-paper"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              YouTube
            </a>
          </div>

          {video.error_message ? (
            <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {video.error_message}
            </p>
          ) : null}

          {video.status === "needs_transcript" ? (
            <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <h2 className="text-sm font-semibold text-amber-900">
                자막을 직접 붙여넣어 주세요
              </h2>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                이 영상에서는 공개 transcript를 찾지 못했어요. 아래 입력창에 자막을 붙여넣으면
                MemoryTube가 요약과 키워드를 만들어 저장합니다.
              </p>
            </div>
          ) : null}

          {summary?.summary ? (
            <section className="mt-8 border-t border-line pt-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-mint">
                Summary
              </p>
              <h2 className="mt-1 text-xl font-semibold">영상 핵심 기억</h2>
              <p className="mt-3 leading-7 text-neutral-700">
                {summary.summary}
              </p>
            </section>
          ) : null}

          {keywords.length > 0 ? (
            <section className="mt-8 border-t border-line pt-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-mint">
                Keywords
              </p>
              <h2 className="mt-1 text-xl font-semibold">다시 찾기 좋은 단서</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-line bg-paper px-3 py-1 text-sm text-neutral-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {visualNotes ? (
            <section className="mt-8 border-t border-line pt-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-mint">
                Visual notes
              </p>
              <h2 className="mt-1 text-xl font-semibold">화면에서 기억할 점</h2>
              <p className="mt-3 whitespace-pre-wrap leading-7 text-neutral-700">
                {visualNotes}
              </p>
            </section>
          ) : null}

          {!summary?.summary ? (
            <section className="mt-8">
              <ManualTranscriptForm videoId={video.id} />
            </section>
          ) : null}

          {transcript?.content ? (
            <section className="mt-8 border-t border-line pt-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-mint">
                Transcript
              </p>
              <h2 className="mt-1 text-xl font-semibold">원문 자막</h2>
              <p className="mt-1 text-sm text-neutral-500">
                출처: {transcript.source === "youtube" ? "YouTube captions" : "직접 입력"}
              </p>
              <details className="mt-4 rounded-lg border border-line bg-paper p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  transcript 펼쳐보기
                </summary>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-neutral-700">
                  {transcript.content}
                </p>
              </details>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "요약 완료",
    needs_transcript: "자막 필요",
    error: "확인 필요",
    processing: "분석 중"
  };

  return labels[status] || status.replace("_", " ");
}
