"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { createClient } from "@/lib/supabase/client";

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeNextPath(searchParams.get("next"));
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);

    try {
      const supabase = createClient();
      const authResponse =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({
              email,
              password,
              options: {
                emailRedirectTo: getEmailRedirectTo()
              }
            });

      if (authResponse.error) {
        setMessage(authResponse.error.message);
        return;
      }

      if (mode === "signup" && !authResponse.data.session) {
        setMessage("Check your email to finish creating the account.");
        return;
      }

      router.push(next);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="mx-auto mt-12 w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-soft">
      <h1 className="text-2xl font-semibold tracking-tight">MemoryTube</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="mt-2 h-11 w-full rounded-md border border-line bg-paper px-3 outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
            className="mt-2 h-11 w-full rounded-md border border-line bg-paper px-3 outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
          />
        </div>

        {message ? (
          <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-neutral-700">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setMessage("");
        }}
        className="mt-4 text-sm font-medium text-mint hover:text-ink"
      >
        {mode === "login" ? "Create an account" : "Use an existing account"}
      </button>
    </section>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={null}>
      <LoginFormInner />
    </Suspense>
  );
}

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  try {
    const baseUrl = "https://memorytube.local";
    const url = new URL(value, baseUrl);

    if (url.origin !== baseUrl) {
      return "/dashboard";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}

function getEmailRedirectTo() {
  const url = new URL("/dashboard", window.location.origin);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid app origin for auth redirect.");
  }

  return url.toString();
}
