export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-[#12100e] p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <div className="h-10 w-64 bg-white/10 rounded-lg animate-pulse mb-2" />
          <div className="h-6 w-96 bg-white/5 rounded-lg animate-pulse" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
              <div className="h-4 w-24 bg-white/10 rounded animate-pulse mb-4" />
              <div className="h-8 w-32 bg-white/10 rounded animate-pulse" />
            </div>
          ))}
        </div>

        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
          <div className="h-6 w-32 bg-white/10 rounded animate-pulse mb-6" />
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-4 items-center">
                <div className="h-12 flex-1 bg-white/5 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
