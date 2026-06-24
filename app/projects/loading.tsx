export default function ProjectsLoading() {
  return (
    <div className="min-h-screen bg-[#12100e] p-4 text-white md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-6">
        <div className="h-9 w-28 rounded-lg bg-white/[0.05]" />
        <div className="h-24 max-w-xl rounded-xl bg-white/[0.04]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-56 rounded-2xl border border-white/[0.06] bg-[#1b1613]" />
          ))}
        </div>
      </div>
    </div>
  )
}
