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
  fetchYouTubeTranscript
} from "@/lib/youtube";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
    }

    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    await ensureUserRow(supabase, user);

    const body = (await request.json()) as {
      url?: string;
      manualTranscript?: string;
    };
    const videoId = extractYouTubeVideoId(body.url || "");

    if (!body.url || !videoId) {
      return NextResponse.json({ error: "Enter a valid YouTube URL." }, { status: 400 });
    }

    const existing = await supabase
      .from("videos")
      .select("id,status")
      .eq("user_id", user.id)
      .eq("youtube_video_id", videoId)
      .maybeSingle();

    if (existing.data) {
      return NextResponse.json({ video: existing.data, duplicate: true });
    }

    const canonicalUrl = canonicalYouTubeUrl(videoId);
    const metadata = await fetchYouTubeMetadata(body.url, videoId);
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
      throw insertError || new Error("Could not save video.");
    }

    const manualTranscript = body.manualTranscript?.trim();
    const transcript =
      manualTranscript && manualTranscript.length > 0
        ? manualTranscript
        : await fetchYouTubeTranscript(videoId);

    if (!transcript) {
      const { data: updated } = await supabase
        .from("videos")
        .update({
          status: "needs_transcript",
          error_message: "No transcript was found."
        })
        .eq("id", video.id)
        .select("id,status")
        .single();

      return NextResponse.json({ video: updated || video });
    }

    try {
      // TODO: Move this synchronous processing to a background job before production.
      const title = metadata.title || "Untitled YouTube video";
      const summary = await summarizeTranscript(title, transcript);
      await logOpenAIUsage(supabase, {
        userId: user.id,
        feature: "video_summary",
        model: summary.model,
        inputSizeEstimate: summary.inputSizeEstimate,
        outputSizeEstimate: summary.outputSizeEstimate
      });

      await supabase.from("transcripts").insert({
        video_id: video.id,
        content: transcript,
        source: manualTranscript ? "manual" : "youtube"
      });

      await supabase.from("summaries").insert({
        video_id: video.id,
        summary: summary.summary,
        keywords: summary.keywords
      });

      await storeVideoChunks(supabase, {
        userId: user.id,
        videoId: video.id,
        transcript,
        summary: summary.summary
      });

      const { data: readyVideo } = await supabase
        .from("videos")
        .update({ status: "ready", error_message: null })
        .eq("id", video.id)
        .select("id,status")
        .single();

      return NextResponse.json({ video: readyVideo || video });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not summarize transcript.";
      await supabase
        .from("videos")
        .update({ status: "error", error_message: message })
        .eq("id", video.id);

      return NextResponse.json({ error: message, video }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save video." },
      { status: 500 }
    );
  }
}
