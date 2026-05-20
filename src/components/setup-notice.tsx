export function SetupNotice() {
  return (
    <section className="mx-auto mt-16 w-full max-w-2xl rounded-lg border border-line bg-white p-6 shadow-soft">
      <p className="text-sm font-semibold uppercase tracking-wide text-mint">
        Setup needed
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
        Connect Supabase first
      </h1>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        Add the values from <span className="font-mono">.env.example</span> to{" "}
        <span className="font-mono">.env.local</span>, run the Supabase schema,
        then restart the dev server.
      </p>
    </section>
  );
}
