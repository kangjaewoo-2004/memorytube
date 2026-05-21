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
  let stage = "manual_transcript_request";

  try {
    const { id } = await params;
    const supabase = await createClient();
    logManualTranscriptStep(stage, { videoId: id });

    stage = "auth";
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      logManualTranscriptError(stage, new Error("Not authenticated."), { videoId: id });
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as { transcript?: string };
    const transcript = body.transcript?.trim();

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required." }, { status: 400 });
    }

    stage = "supabase_video_lookup";
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("id,title,user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (videoError || !video) {
      logManualTranscriptError(
        stage,
        videoError || new Error("Video not found."),
        { videoId: id }
      );
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    }

    const title = video.title || "Untitled YouTube video";
    stage = "summary_generate";
    logManualTranscriptStep(stage, {
      videoId: id,
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      transcriptLength: transcript.length
    });
    const summary = await summarizeTranscript(title, transcript);
    logManualTranscriptStep(stage, {
      videoId: id,
      model: summary.model,
      inputSizeEstimate: summary.inputSizeEstimate,
      outputSizeEstimate: summary.outputSizeEstimate
    });

    stage = "openai_usage_log_summary";
    await logOpenAIUsage(supabase, {
      userId: user.id,
      feature: "manual_transcript_summary",
      model: summary.model,
      inputSizeEstimate: summary.inputSizeEstimate,
      outputSizeEstimate: summary.outputSizeEstimate
    });

    stage = "supabase_existing_transcript_delete";
    const { error: transcriptDeleteError } = await supabase
      .from("transcripts")
      .delete()
      .eq("video_id", id);

    if (transcriptDeleteError) {
      throw new Error(
        `Supabase transcript delete failed: ${transcriptDeleteError.message}`
      );
    }

    stage = "supabase_existing_summary_delete";
    const { error: summaryDeleteError } = await supabase
      .from("summaries")
      .delete()
      .eq("video_id", id);

    if (summaryDeleteError) {
      throw new Error(`Supabase summary delete failed: ${summaryDeleteError.message}`);
    }

    stage = "supabase_transcript_insert";
    const { error: transcriptInsertError } = await supabase.from("transcripts").insert({
      video_id: id,
      content: transcript,
      source: "manual"
    });

    if (transcriptInsertError) {
      throw new Error(
        `Supabase transcript insert failed: ${transcriptInsertError.message}`
      );
    }

    stage = "supabase_summary_insert";
    const { error: summaryInsertError } = await supabase.from("summaries").insert({
      video_id: id,
      summary: summary.summary,
      keywords: summary.keywords
    });

    if (summaryInsertError) {
      throw new Error(`Supabase summary insert failed: ${summaryInsertError.message}`);
    }

    stage = "embedding_generate";
    logManualTranscriptStep(stage, { videoId: id });
    await storeVideoChunks(supabase, {
      userId: user.id,
      videoId: id,
      transcript,
      summary: summary.summary
    });
    logManualTranscriptStep(stage, { videoId: id, status: "complete" });

    stage = "supabase_video_update_ready";
    const { error: readyUpdateError } = await supabase
      .from("videos")
      .update({ status: "ready", error_message: null })
      .eq("id", id);

    if (readyUpdateError) {
      throw new Error(`Supabase ready update failed: ${readyUpdateError.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logManualTranscriptError(stage, error);
    return NextResponse.json(
      {
        stage,
        error:
          error instanceof Error ? error.message : "Could not summarize transcript."
      },
      { status: 500 }
    );
  }
}

function logManualTranscriptStep(stage: string, details: Record<string, unknown> = {}) {
  console.info("[MemoryTube manual transcript]", { stage, ...details });
}

function logManualTranscriptError(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {}
) {
  console.error("[MemoryTube manual transcript error]", {
    stage,
    message: error instanceof Error ? error.message : String(error),
    ...details
  });
}
