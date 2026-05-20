const YOUTUBE_ID_LENGTH = 11;

export type YouTubeMetadata = {
  title: string | null;
  thumbnailUrl: string | null;
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
      return { title: null, thumbnailUrl: fallbackThumbnail };
    }

    const data = (await response.json()) as {
      title?: string;
      thumbnail_url?: string;
    };

    return {
      title: data.title || null,
      thumbnailUrl: data.thumbnail_url || fallbackThumbnail
    };
  } catch {
    return { title: null, thumbnailUrl: fallbackThumbnail };
  }
}

export async function fetchYouTubeTranscript(videoId: string) {
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const rows = await YoutubeTranscript.fetchTranscript(videoId);
    const transcript = rows
      .map((row) => row.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return transcript.length > 0 ? transcript : null;
  } catch {
    return null;
  }
}

function isValidVideoId(id: string | null | undefined) {
  return Boolean(id && /^[a-zA-Z0-9_-]+$/.test(id) && id.length === YOUTUBE_ID_LENGTH);
}
