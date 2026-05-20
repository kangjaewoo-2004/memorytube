import { redirect } from "next/navigation";

import { AddVideoForm } from "@/components/add-video-form";
import { SetupNotice } from "@/components/setup-notice";
import { VideoCard } from "@/components/video-card";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: videos } = await supabase
    .from("videos")
    .select("id,title,thumbnail_url,youtube_url,status,error_message,created_at,summaries(summary,keywords)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const readyCount = videos?.filter((video) => video.status === "ready").length || 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <aside>
        <AddVideoForm />
      </aside>
      <section>
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-line bg-white p-5 shadow-soft sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-mint">
              기억 저장소
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              저장한 YouTube 영상
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
              영상의 자막, 요약, 키워드를 모아두고 나중에 채팅으로 다시 꺼내볼 수 있어요.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:w-48">
            <div className="rounded-md bg-paper px-3 py-2">
              <p className="text-xs text-neutral-500">전체</p>
              <p className="mt-1 font-semibold">{videos?.length || 0}개</p>
            </div>
            <div className="rounded-md bg-paper px-3 py-2">
              <p className="text-xs text-neutral-500">요약 완료</p>
              <p className="mt-1 font-semibold">{readyCount}개</p>
            </div>
          </div>
        </div>

        {videos?.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center shadow-soft">
            <p className="text-sm font-semibold uppercase tracking-wide text-mint">
              첫 기억을 기다리는 중
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              YouTube 링크를 붙여넣어 첫 기억을 저장하세요
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-600">
              왼쪽 입력창에 링크를 넣으면 MemoryTube가 자막을 찾고, 요약과 키워드를 만들어 저장해요.
              자막이 없으면 transcript를 직접 붙여넣을 수 있습니다.
            </p>
            <div className="mx-auto mt-6 grid max-w-lg gap-3 text-left text-sm sm:grid-cols-3">
              {["링크 붙여넣기", "자막 분석", "요약 저장"].map((step, index) => (
                <div key={step} className="rounded-md bg-paper p-3">
                  <p className="text-xs font-semibold text-mint">Step {index + 1}</p>
                  <p className="mt-1 font-medium text-ink">{step}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
