export default function ChatLoading() {
  return (
    <div className="h-screen bg-[#08070d] flex overflow-hidden">
      <div className="fixed left-0 top-0 h-screen w-80 bg-[#0a0a10]/95 border-r border-white/[0.06] p-4">
        <div className="h-10 bg-white/[0.04] rounded-lg animate-pulse mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-white/[0.03] rounded-lg animate-pulse" />
          ))}
        </div>
      </div>

      <main className="flex-1 flex flex-col ml-80">
        <div className="border-b border-white/[0.06] p-4">
          <div className="h-10 w-48 bg-white/[0.04] rounded-lg animate-pulse" />
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-violet-500/60 border-t-transparent rounded-full" />
        </div>
      </main>
    </div>
  )
}
