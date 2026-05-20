export default function DashboardLoading() {
  return (
    <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <div className="h-80 animate-pulse rounded-lg bg-white" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-56 animate-pulse rounded-lg bg-white" />
        <div className="h-56 animate-pulse rounded-lg bg-white" />
      </div>
    </div>
  );
}
