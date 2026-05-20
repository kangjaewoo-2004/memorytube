export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseConfig());
}

const DEFAULT_LOW_COST_MODEL = "gpt-4.1-mini";

export function getOpenAISummaryModel() {
  return (
    process.env.OPENAI_SUMMARY_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_LOW_COST_MODEL
  );
}

export function getOpenAIChatModel() {
  return (
    process.env.OPENAI_CHAT_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_LOW_COST_MODEL
  );
}

export function getOpenAIEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
}

export function getOpenAIVisionModel() {
  return process.env.OPENAI_VISION_MODEL || DEFAULT_LOW_COST_MODEL;
}
