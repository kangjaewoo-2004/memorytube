export const OPENAI_SAFETY = {
  maxTranscriptChars: 32000,
  maxEmbeddingInputChars: 8000,
  maxChatChunks: 8,
  maxChatContextTokens: 6000,
  maxChatHistoryMessages: 6,
  maxChatHistoryMessageChars: 900,
  summaryMaxOutputTokens: 700,
  chatMaxOutputTokens: 900
};

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function clipTextByChars(text: string, maxLength: number, label: string) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n\n[${label} clipped for MVP cost protection]`;
}
