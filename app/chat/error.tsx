'use client'

export default function ChatError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0f0f0f] p-4 text-center">
      <div className="max-w-sm rounded-2xl border border-white/[0.08] bg-[#181818] p-6">
        <p className="text-sm text-gray-200">Something went wrong loading your session. Tap to retry.</p>
        <button
          type="button"
          onClick={() => {
            reset()
            window.location.reload()
          }}
          className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
        >
          Retry
        </button>
      </div>
    </div>
  )
}
