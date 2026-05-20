import { NextResponse } from "next/server";

import { summarizeTranscript } from "@/lib/openai";
import { logOpenAIUsage } from "@/lib/openai-usage";
import { storeVideoChunks } from "@/lib/rag";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as { transcript?: string };
    const transcript = body.transcript?.trim();

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required." }, { status: 400 });
    }

    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id,title,user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    }

    const title = video.title || "Untitled YouTube video";
    const summary = await summarizeTranscript(title, transcript);
    await logOpenAIUsage(supabase, {
      userId: user.id,
      feature: "manual_transcript_summary",
      model: summary.model,
      inputSizeEstimate: summary.inputSizeEstimate,
      outputSizeEstimate: summary.outputSizeEstimate
    });

    await supabase.from("transcripts").delete().eq("video_id", id);
    await supabase.from("summaries").delete().eq("video_id", id);

    await supabase.from("transcripts").insert({
      video_id: id,
      content: transcript,
      source: "manual"
    });

    await supabase.from("summaries").insert({
      video_id: id,
      summary: summary.summary,
      keywords: summary.keywords
    });

    await storeVideoChunks(supabase, {
      userId: user.id,
      videoId: id,
      transcript,
      summary: summary.summary
    });

    await supabase
      .from("videos")
      .update({ status: "ready", error_message: null })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not summarize transcript."
      },
      { status: 500 }
    );
  }
}
