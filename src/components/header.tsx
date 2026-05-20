import { CirclePlay, LogOut, MessageSquare } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

async function signOut() {
  "use server";

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  redirect("/login");
}

export async function Header() {
  let isSignedIn = false;

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    isSignedIn = Boolean(user);
  }

  return (
    <header className="border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink text-white">
            <CirclePlay className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>MemoryTube</span>
        </Link>

        {isSignedIn ? (
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-2 text-neutral-700 hover:bg-white hover:text-ink"
            >
              Videos
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-neutral-700 hover:bg-white hover:text-ink"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Chat
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-neutral-700 hover:text-ink"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </nav>
        ) : (
          <Link
            href="/login"
            className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:border-neutral-300"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}
