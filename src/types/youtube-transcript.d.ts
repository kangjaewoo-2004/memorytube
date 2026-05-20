declare module "youtube-transcript" {
  export const YoutubeTranscript: {
    fetchTranscript(videoId: string): Promise<Array<{ text: string }>>;
  };
}
