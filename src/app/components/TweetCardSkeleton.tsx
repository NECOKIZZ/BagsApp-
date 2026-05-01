/**
 * Lightweight skeleton placeholder that mimics the shape of a TweetCard while
 * the feed is loading. Pure presentational component — no logic, no state.
 */
export function TweetCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#1a1f2e]/60 bg-[#0B0F17]/60 mb-3 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#151a26] animate-pulse" />
            <div className="flex items-center gap-1.5">
              <div className="h-4 w-20 bg-[#151a26] rounded animate-pulse" />
              <div className="h-3 w-16 bg-[#1a1f2e] rounded animate-pulse" />
            </div>
          </div>
          <div className="h-5 w-12 rounded bg-[#151a26] animate-pulse" />
        </div>
        <div className="space-y-2 mb-3">
          <div className="h-3 w-full bg-[#151a26]/70 rounded animate-pulse" />
          <div className="h-3 w-11/12 bg-[#151a26]/70 rounded animate-pulse" />
          <div className="h-3 w-2/3 bg-[#151a26]/70 rounded animate-pulse" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-5">
            <div className="h-3 w-10 bg-[#1a1f2e] rounded animate-pulse" />
            <div className="h-3 w-10 bg-[#1a1f2e] rounded animate-pulse" />
            <div className="h-3 w-10 bg-[#1a1f2e] rounded animate-pulse" />
          </div>
          <div className="h-7 w-20 rounded-md bg-[#151a26] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
