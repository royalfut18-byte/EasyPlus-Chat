export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <div className="h-10 w-48 bg-white/10 rounded-lg animate-pulse mb-2" />
          <div className="h-6 w-80 bg-white/5 rounded-lg animate-pulse" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
              <div className="h-4 w-20 bg-white/10 rounded animate-pulse mb-4" />
              <div className="h-8 w-24 bg-white/10 rounded animate-pulse" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
              <div className="h-6 w-40 bg-white/10 rounded animate-pulse mb-4" />
              <div className="space-y-3">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="h-16 bg-white/5 rounded-lg animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
