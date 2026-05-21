import { NextResponse } from "next/server";

import { ensureUserRow } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { summarizeTranscript } from "@/lib/openai";
import { logOpenAIUsage } from "@/lib/openai-usage";
import { storeVideoChunks } from "@/lib/rag";
import { createClient } from "@/lib/supabase/server";
import {
  canonicalYouTubeUrl,
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  fetchYouTubeTranscriptResult
} from "@/lib/youtube";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let step = "request_start";
  const completedSteps: string[] = [];

  function completeStep(name: string, details: Record<string, unknown> = {}) {
    completedSteps.push(name);
    logVideoSaveStep(name, { ...details, completedSteps: [...completedSteps] });
  }

  function fail(
    name: string,
    error: unknown,
    details: Record<string, unknown> = {},
    status = 500
  ) {
    const message = getErrorMessage(error);
    const responseDetails = { ...details, completedSteps: [...completedSteps] };

    logVideoSaveError(name, error, responseDetails);

    return NextResponse.json(
      {
        error: message,
        step: name,
        message,
        details: responseDetails
      },
      { status }
    );
  }

  try {
    if (!isSupabaseConfigured()) {
      return fail(
        "supabase_config_missing",
        new Error("Supabase is not configured."),
        {},
        500
      );
    }

    completeStep(step);
    const supabase = await createClient();
    step = "auth";
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return fail("auth_user_missing", new Error("Not authenticated."), {}, 401);
    }
    completeStep(step, { userId: user.id });

    step = "supabase_user_upsert";
    await ensureUserRow(supabase, user);
    completeStep(step, { userId: user.id });

    step = "request_json_parse";
    const body = (await request.json()) as {
      url?: string;
      manualTranscript?: string;
    };
    completeStep(step, { hasUrl: Boolean(body.url) });

    step = "url_parse";
    const videoId = extractYouTubeVideoId(body.url || "");

    if (!body.url || !videoId) {
      return fail(
        "invalid_youtube_url",
        new Error("Enter a valid YouTube URL."),
        { hasUrl: Boolean(body.url), inputPreview: body.url?.slice(0, 80) || "" },
        400
      );
    }
    completeStep(step, { videoId });

    step = "supabase_duplicate_lookup";
    const { data: existingVideo, error: duplicateError } = await supabase
      .from("videos")
      .select("id,status")
      .eq("user_id", user.id)
      .eq("youtube_video_id", videoId)
      .maybeSingle();

    if (duplicateError) {
      return fail(
        "supabase_duplicate_lookup_failed",
        duplicateError,
        { videoId },
        500
      );
    }

    if (existingVideo) {
      completeStep(step, {
        videoId: existingVideo.id,
        duplicate: true
      });
      return NextResponse.json({ video: existingVideo, duplicate: true });
    }
    completeStep(step, { videoId, duplicate: false });

    const canonicalUrl = canonicalYouTubeUrl(videoId);
    step = "youtube_metadata_fetch";
    const metadata = await fetchYouTubeMetadata(body.url, videoId);
    if (metadata.error) {
      logVideoSaveError("video_metadata_failed", new Error(metadata.error), {
        videoId,
        completedSteps: [...completedSteps]
      });
    }
    completeStep(step, {
      videoId,
      hasTitle: Boolean(metadata.title),
      hasThumbnail: Boolean(metadata.thumbnailUrl),
      metadataError: metadata.error || null
    });

    step = "supabase_video_insert";
    const { data: video, error: insertError } = await supabase
      .from("videos")
      .insert({
        user_id: user.id,
        youtube_url: canonicalUrl,
        youtube_video_id: videoId,
        title: metadata.title,
        thumbnail_url: metadata.thumbnailUrl,
        status: "processing"
      })
      .select("id,status")
      .single();

    if (insertError || !video) {
      return fail(
        "supabase_video_insert_failed",
        new Error(
          `Supabase video insert failed: ${
          insertError?.message || "No video row returned."
          }`
        ),
        { videoId, supabaseCode: insertError?.code || null },
        500
      );
    }

    completeStep(step, {
      videoId: video.id,
      status: video.status
    });

    const manualTranscript = body.manualTranscript?.trim();
    step = "transcript_fetch";
    logVideoSaveStep(step, {
      videoId: video.id,
      source: manualTranscript ? "manual" : "youtube"
    });

    const transcriptResult =
      manualTranscript && manualTranscript.length > 0
        ? { transcript: manualTranscript, error: null }
        : await fetchYouTubeTranscriptResult(videoId);
    const transcript = transcriptResult.transcript;

    if (transcriptResult.error) {
      logVideoSaveError("transcript_fetch_failed", new Error(transcriptResult.error), {
        videoId: video.id,
        completedSteps: [...completedSteps]
      });
    }

    completeStep(step, {
      videoId: video.id,
      hasTranscript: Boolean(transcript),
      transcriptLength: transcript?.length || 0,
      transcriptError: transcriptResult.error || null
    });

    if (!transcript) {
      step = "supabase_video_update_needs_transcript";
      const { data: updated, error: updateError } = await supabase
        .from("videos")
        .update({
          status: "needs_transcript",
          error_message: "No transcript was found."
        })
        .eq("id", video.id)
        .select("id,status")
        .single();

      if (updateError) {
        return fail(
          "transcript_fetch_failed",
          new Error(
            `Supabase video update failed after transcript miss: ${updateError.message}`
          ),
          { videoId: video.id, supabaseCode: updateError.code || null },
          500
        );
      }

      completeStep(step, {
        videoId: video.id,
        status: updated?.status || video.status
      });
      return NextResponse.json({ video: updated || video });
    }

    try {
      // TODO: Move this synchronous processing to a background job before production.
      const title = metadata.title || "Untitled YouTube video";
      step = "openai_summary";
      logVideoSaveStep(step, {
        videoId: video.id,
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        transcriptLength: transcript.length
      });
      const summary = await summarizeTranscript(title, transcript);
      completeStep(step, {
        videoId: video.id,
        model: summary.model,
        inputSizeEstimate: summary.inputSizeEstimate,
        outputSizeEstimate: summary.outputSizeEstimate
      });

      step = "openai_usage_log_summary";
      await logOpenAIUsage(supabase, {
        userId: user.id,
        feature: "video_summary",
        model: summary.model,
        inputSizeEstimate: summary.inputSizeEstimate,
        outputSizeEstimate: summary.outputSizeEstimate
      });
      completeStep(step, { videoId: video.id });

      step = "supabase_transcript_insert";
      const { error: transcriptInsertError } = await supabase.from("transcripts").insert({
        video_id: video.id,
        content: transcript,
        source: manualTranscript ? "manual" : "youtube"
      });

      if (transcriptInsertError) {
        return fail(
          "supabase_transcript_insert_failed",
          new Error(
            `Supabase transcript insert failed: ${transcriptInsertError.message}`
          ),
          { videoId: video.id, supabaseCode: transcriptInsertError.code || null },
          500
        );
      }
      completeStep(step, { videoId: video.id });

      step = "supabase_summary_insert";
      const { error: summaryInsertError } = await supabase.from("summaries").insert({
        video_id: video.id,
        summary: summary.summary,
        keywords: summary.keywords
      });

      if (summaryInsertError) {
        return fail(
          "supabase_summary_insert_failed",
          new Error(`Supabase summary insert failed: ${summaryInsertError.message}`),
          { videoId: video.id, supabaseCode: summaryInsertError.code || null },
          500
        );
      }
      completeStep(step, { videoId: video.id });

      step = "embedding_generate";
      logVideoSaveStep(step, { videoId: video.id });
      await storeVideoChunks(supabase, {
        userId: user.id,
        videoId: video.id,
        transcript,
        summary: summary.summary
      });
      completeStep(step, { videoId: video.id, status: "complete" });

      step = "supabase_video_update_ready";
      const { data: readyVideo, error: readyUpdateError } = await supabase
        .from("videos")
        .update({ status: "ready", error_message: null })
        .eq("id", video.id)
        .select("id,status")
        .single();

      if (readyUpdateError) {
        return fail(
          "supabase_video_update_ready_failed",
          new Error(`Supabase ready update failed: ${readyUpdateError.message}`),
          { videoId: video.id, supabaseCode: readyUpdateError.code || null },
          500
        );
      }

      completeStep(step, {
        videoId: video.id,
        status: readyVideo?.status || video.status
      });
      return NextResponse.json({ video: readyVideo || video });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not summarize transcript.";
      const failureStep = mapProcessingErrorStep(step, error);
      logVideoSaveError(failureStep, error, {
        videoId: video.id,
        completedSteps: [...completedSteps]
      });
      const { error: errorUpdateError } = await supabase
        .from("videos")
        .update({ status: "error", error_message: message })
        .eq("id", video.id);

      if (errorUpdateError) {
        logVideoSaveError("supabase_video_update_error_status", errorUpdateError, {
          videoId: video.id,
          completedSteps: [...completedSteps]
        });
      }

      return NextResponse.json(
        {
          error: message,
          step: failureStep,
          message,
          details: {
            videoId: video.id,
            originalStep: step,
            completedSteps: [...completedSteps]
          },
          video
        },
        { status: 500 }
      );
    }
  } catch (error) {
    return fail(step, error);
  }
}

function mapProcessingErrorStep(step: string, error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes("video_chunks insert") || message.includes("video_chunks delete")) {
    return "supabase_chunk_insert_failed";
  }

  if (message.includes("embedding")) {
    return "embedding_failed";
  }

  if (message.includes("OpenAI summary") || step === "openai_summary") {
    return "openai_summary_failed";
  }

  return step;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function logVideoSaveStep(step: string, details: Record<string, unknown> = {}) {
  console.info("[MemoryTube video save]", { step, ...details });
}

function logVideoSaveError(
  step: string,
  error: unknown,
  details: Record<string, unknown> = {}
) {
  console.error("[MemoryTube video save error]", {
    step,
    message: getErrorMessage(error),
    ...details
  });
}
