export default function ChatLoading() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#212121]">
      <div className="fixed left-0 top-0 hidden h-screen w-72 border-r border-white/[0.06] bg-[#171717] p-4 md:block">
        <div className="h-10 bg-white/[0.04] rounded-lg animate-pulse mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-white/[0.03] rounded-lg animate-pulse" />
          ))}
        </div>
      </div>

      <main className="ml-0 flex flex-1 flex-col md:ml-72">
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
