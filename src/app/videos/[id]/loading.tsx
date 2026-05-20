export default function VideoLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="h-6 w-24 animate-pulse rounded bg-white" />
      <div className="mt-5 overflow-hidden rounded-lg border border-line bg-white shadow-soft">
        <div className="aspect-video animate-pulse bg-neutral-100" />
        <div className="space-y-4 p-6">
          <div className="h-8 w-2/3 animate-pulse rounded bg-paper" />
          <div className="h-24 animate-pulse rounded bg-paper" />
        </div>
      </div>
    </div>
  );
}
