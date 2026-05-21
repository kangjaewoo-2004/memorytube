const YOUTUBE_ID_LENGTH = 11;

export type YouTubeMetadata = {
  title: string | null;
  thumbnailUrl: string | null;
  error?: string | null;
};

export type YouTubeTranscriptResult = {
  transcript: string | null;
  error?: string | null;
};

export function extractYouTubeVideoId(input: string) {
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return isValidVideoId(id) ? id : null;
    }

    if (host.endsWith("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (isValidVideoId(watchId)) {
        return watchId;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) =>
        ["embed", "shorts", "live"].includes(part)
      );
      const id = marker >= 0 ? parts[marker + 1] : null;
      return isValidVideoId(id) ? id : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function canonicalYouTubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export async function fetchYouTubeMetadata(
  url: string,
  videoId: string
): Promise<YouTubeMetadata> {
  const fallbackThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      {
        next: { revalidate: 60 * 60 * 24 }
      }
    );

    if (!response.ok) {
      const message = `YouTube metadata request failed with HTTP ${response.status}.`;
      console.error("[MemoryTube YouTube metadata] Fetch failed.", {
        videoId,
        message
      });
      return { title: null, thumbnailUrl: fallbackThumbnail, error: message };
    }

    const data = (await response.json()) as {
      title?: string;
      thumbnail_url?: string;
    };

    return {
      title: data.title || null,
      thumbnailUrl: data.thumbnail_url || fallbackThumbnail
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[MemoryTube YouTube metadata] Fetch failed.", {
      videoId,
      message
    });
    return { title: null, thumbnailUrl: fallbackThumbnail, error: message };
  }
}

export async function fetchYouTubeTranscript(videoId: string) {
  const result = await fetchYouTubeTranscriptResult(videoId);

  return result.transcript;
}

export async function fetchYouTubeTranscriptResult(
  videoId: string
): Promise<YouTubeTranscriptResult> {
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const rows = await YoutubeTranscript.fetchTranscript(videoId);
    const transcript = rows
      .map((row) => row.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return { transcript: transcript.length > 0 ? transcript : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[MemoryTube YouTube transcript] Fetch failed.", {
      videoId,
      message
    });

    return { transcript: null, error: message };
  }
}

function isValidVideoId(id: string | null | undefined) {
  return Boolean(id && /^[a-zA-Z0-9_-]+$/.test(id) && id.length === YOUTUBE_ID_LENGTH);
}
