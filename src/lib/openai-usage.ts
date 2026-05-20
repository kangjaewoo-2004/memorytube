import type { SupabaseClient } from "@supabase/supabase-js";

type OpenAIUsageLogInput = {
  userId: string;
  feature: string;
  model: string;
  inputSizeEstimate: number;
  outputSizeEstimate: number;
};

export async function logOpenAIUsage(
  supabase: SupabaseClient,
  input: OpenAIUsageLogInput
) {
  const { error } = await supabase.from("openai_usage_logs").insert({
    user_id: input.userId,
    feature: input.feature,
    model: input.model,
    input_size_estimate: input.inputSizeEstimate,
    output_size_estimate: input.outputSizeEstimate
  });

  if (error && process.env.NODE_ENV !== "production") {
    console.warn("[MemoryTube OpenAI usage log] Insert failed.", error.message);
  }
}
