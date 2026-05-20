import Link from "next/link";
import { redirect } from "next/navigation";

import { ChatInterface } from "@/components/chat-interface";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function ChatPage() {
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

  const { count } = await supabase
    .from("videos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "ready");

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <div className="mb-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-mint">
          기억에게 질문하기
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          저장한 영상과 대화하기
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          저장된 영상의 요약과 transcript 안에서만 답을 찾습니다.
        </p>
      </div>

      {count ? (
        <ChatInterface />
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-mint">
            아직 물어볼 기억이 없어요
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            먼저 YouTube 영상을 저장해 주세요
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-600">
            요약이 완료된 영상이 생기면 “내 저장 영상들 공통점 알려줘” 같은 질문을 바로 할 수 있어요.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-white"
          >
            영상 저장하러 가기
          </Link>
        </div>
      )}
    </section>
  );
}
