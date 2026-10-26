export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" aria-busy="true" className="mx-auto w-full max-w-7xl animate-pulse space-y-6 py-4">
      <span className="sr-only">Loading…</span>
      <div className="h-3 w-28 rounded bg-steel" />
      <div className="h-10 w-2/3 max-w-xl rounded bg-steel" />
      <div className="h-4 w-full max-w-2xl rounded bg-steel/80" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="aspect-[4/3] bg-steel" />
            <div className="space-y-3 p-4">
              <div className="h-3 w-1/3 rounded bg-steel" />
              <div className="h-5 w-4/5 rounded bg-steel" />
              <div className="h-3 w-1/2 rounded bg-steel/80" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
