'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Code2, Download, FolderOpen, Loader2, Sparkles } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { cn } from '@/lib/utils'

interface EasyCodeProject {
  id: string
  title: string
  description: string | null
  framework: string | null
  generation_status?: 'idle' | 'generating' | 'ready' | 'failed'
  updated_at: string
  created_at: string
}

const EXAMPLES = [
  'Build a modern landing page for a bakery',
  'Create a dashboard for managing clients',
  'Make a Flappy Bird game in Python',
  'Build a Shopify-style product page',
  'Create a portfolio website',
  'Make a React app with dark mode',
]

export function EasyCodeHomeClient({ initialProjects }: { initialProjects: EasyCodeProject[] }) {
  const [projects, setProjects] = useState(initialProjects)
  const [prompt, setPrompt] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const createProject = async (value = prompt) => {
    const clean = value.trim()
    if (clean.length < 5 || isCreating) return
    setIsCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/easy-code/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: clean }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.project?.id) throw new Error(data?.error || 'Could not create project. Please try again.')
      setProjects(prev => [data.project, ...prev])
      router.push(`/easy-code/${data.project.id}`)
    } catch (error: any) {
      setError(error?.message || 'Could not create project. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#0f0f0f] px-4 py-5 text-white md:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/chat" className="rounded-xl p-1 transition-colors hover:bg-white/[0.04]">
          <Logo size="sm" showText />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/chat" className="rounded-full border border-white/[0.08] px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white">
            Back to Chat
          </Link>
        </div>
      </div>

      <section className="mx-auto flex min-h-[58vh] max-w-4xl flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-100">
          <Code2 className="h-3.5 w-3.5" />
          Easy Code
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">What do you want to build?</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
          Describe your app, website, script, or tool. Easy Code will generate the files, preview it, and let you download the project.
        </p>

        <div className="mt-8 w-full rounded-[28px] border border-white/[0.10] bg-[#191919] p-3 shadow-2xl shadow-black/30">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                createProject()
              }
            }}
            disabled={isCreating}
            rows={4}
            placeholder="Build a modern SaaS landing page with pricing, dashboard mockup, and dark mode..."
            className="min-h-28 w-full resize-none rounded-3xl border border-white/[0.06] bg-[#101010] p-4 text-base text-white outline-none placeholder:text-gray-500 focus:border-violet-300/25 disabled:opacity-60"
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-left text-xs text-gray-500">DeepSeek V4 Pro will create a file-based starter project you can edit and export.</p>
            <button
              type="button"
              onClick={() => createProject()}
              disabled={prompt.trim().length < 5 || isCreating}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create Project
            </button>
          </div>
          {error && <p className="mt-3 text-left text-sm text-red-300">{error}</p>}
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map(example => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setPrompt(example)
                createProject(example)
              }}
              disabled={isCreating}
              className="rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl pb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Recent coding projects</h2>
          <span className="text-xs text-gray-500">{projects.length} project{projects.length === 1 ? '' : 's'}</span>
        </div>
        {projects.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-white/[0.10] bg-white/[0.02] p-8 text-center">
            <FolderOpen className="mx-auto h-10 w-10 text-gray-500" />
            <p className="mt-3 text-sm text-gray-300">No Easy Code projects yet.</p>
            <p className="mt-1 text-xs text-gray-500">Create your first app, site, script, or tool from the prompt above.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map(project => (
              <Link
                key={project.id}
                href={`/easy-code/${project.id}`}
                className={cn(
                  'group rounded-[24px] border border-white/[0.08] bg-[#191919] p-5 transition-colors',
                  'hover:border-violet-300/20 hover:bg-[#202020]'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-200">
                    <Code2 className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-600 transition-colors group-hover:text-violet-200" />
                </div>
                <h3 className="mt-4 line-clamp-2 font-semibold text-white">{project.title}</h3>
                <p className="mt-2 line-clamp-2 text-sm text-gray-500">{project.description || 'Easy Code project'}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                  <span>{project.framework || 'project'}</span>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-1',
                    project.generation_status === 'failed'
                      ? 'bg-red-500/10 text-red-200'
                      : project.generation_status === 'generating'
                        ? 'bg-amber-500/10 text-amber-200'
                        : 'bg-emerald-500/10 text-emerald-200'
                  )}>
                    {project.generation_status === 'generating' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    {project.generation_status === 'failed' ? 'Failed' : project.generation_status === 'generating' ? 'Generating' : 'Ready'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
