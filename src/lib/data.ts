import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function ensureUserRow(supabase: SupabaseClient, user: User) {
  const { error } = await supabase.from("users").upsert({
    id: user.id,
    email: user.email,
    updated_at: new Date().toISOString()
  });

  if (error) {
    throw error;
  }
}
