'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Code2, Download, FolderOpen, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { cn } from '@/lib/utils'

interface EasyCodeProject {
  id: string
  title: string
  description: string | null
  framework: string | null
  generation_status?: 'idle' | 'generating' | 'ready' | 'failed' | 'incomplete'
  file_count?: number
  meaningful_file_count?: number
  is_download_ready?: boolean
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

function formatProjectDate(value: string): string {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Recently updated'
  const diff = Date.now() - time
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.round(hours / 24)}d ago`
}

export function EasyCodeHomeClient({ initialProjects }: { initialProjects: EasyCodeProject[] }) {
  const [projects, setProjects] = useState(initialProjects)
  const [prompt, setPrompt] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const createLockRef = useRef(false)
  const clientRequestRef = useRef<{ prompt: string; id: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    const refreshProjects = async () => {
      const response = await fetch('/api/easy-code/projects', { cache: 'no-store' }).catch(() => null)
      if (!response?.ok) return
      const data = await response.json().catch(() => ({}))
      if (Array.isArray(data.projects)) setProjects(data.projects)
    }
    const timer = window.setInterval(refreshProjects, 3000)
    return () => window.clearInterval(timer)
  }, [])

  const createProject = async (value = prompt) => {
    const clean = value.trim()
    if (clean.length < 5 || createLockRef.current) return
    createLockRef.current = true
    setIsCreating(true)
    setError(null)
    const clientRequestId = clientRequestRef.current?.prompt === clean
      ? clientRequestRef.current.id
      : crypto.randomUUID()
    clientRequestRef.current = { prompt: clean, id: clientRequestId }
    try {
      const response = await fetch('/api/easy-code/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: clean, clientRequestId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.project?.id) throw new Error(data?.error || 'Could not create project. Please try again.')
      setProjects(prev => [data.project, ...prev.filter(project => project.id !== data.project.id)])
      router.push(`/easy-code/${data.project.id}`)
    } catch (error: any) {
      setError(error?.message === 'Failed to fetch'
        ? 'Could not confirm project creation. Please check Recent coding projects before retrying.'
        : error?.message || 'Could not create project. Please try again.')
    } finally {
      createLockRef.current = false
      setIsCreating(false)
    }
  }

  const deleteProject = async (project: EasyCodeProject) => {
    const confirmed = window.confirm('Delete this Easy Code project? This will remove its files and messages.')
    if (!confirmed || deletingProjectId) return
    setDeletingProjectId(project.id)
    setError(null)
    try {
      const response = await fetch(`/api/easy-code/projects/${project.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not delete project.')
      setProjects(prev => prev.filter(item => item.id !== project.id))
    } catch (error: any) {
      setError(error?.message || 'Could not delete project.')
    } finally {
      setDeletingProjectId(null)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#12100e] px-4 py-5 text-white md:px-8">
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
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-clay-300/15 bg-clay-500/10 px-3 py-1 text-xs font-medium text-clay-100">
          <Code2 className="h-3.5 w-3.5" />
          Easy Code
        </div>
        <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-[3.5rem]">What do you want to build?</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
          Describe your app, website, script, or tool. Easy Code will generate the files, preview it, and let you download the project.
        </p>

        <div className="mt-8 w-full rounded-[28px] border border-white/[0.10] bg-[#1c1714] p-3 shadow-2xl shadow-black/30">
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
            className="min-h-28 w-full resize-none rounded-3xl border border-white/[0.06] bg-[#13110f] p-4 text-base text-white outline-none placeholder:text-gray-500 focus:border-clay-300/25 disabled:opacity-60"
          />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-left text-xs text-gray-500">Easy Code will create a file-based starter project you can edit and export.</p>
            <button
              type="button"
              onClick={() => createProject()}
              disabled={prompt.trim().length < 5 || isCreating}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-clay-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-clay-500 disabled:cursor-not-allowed disabled:opacity-50"
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
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/easy-code/${project.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    router.push(`/easy-code/${project.id}`)
                  }
                }}
                className={cn(
                  'group cursor-pointer rounded-[24px] border border-white/[0.08] bg-[#1c1714] p-5 transition-colors',
                  'hover:border-clay-300/20 hover:bg-[#202020]'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-clay-500/10 text-clay-200">
                    <Code2 className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        deleteProject(project)
                      }}
                      disabled={deletingProjectId === project.id}
                      className="rounded-full border border-red-400/10 p-2 text-red-300 opacity-80 transition-colors hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Delete project"
                    >
                      {deletingProjectId === project.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                    <ArrowRight className="h-4 w-4 text-gray-600 transition-colors group-hover:text-clay-200" />
                  </div>
                </div>
                <h3 className="mt-4 line-clamp-2 font-semibold text-white">{project.title}</h3>
                <p className="mt-2 line-clamp-2 text-sm text-gray-500">{project.description || 'Easy Code project'}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                  <span>{project.framework || 'project'}</span>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-1',
                    project.generation_status === 'failed' || project.generation_status === 'incomplete'
                      ? 'bg-red-500/10 text-red-200'
                      : project.generation_status === 'generating'
                        ? 'bg-amber-500/10 text-amber-200'
                        : 'bg-emerald-500/10 text-emerald-200'
                  )}>
                    {project.generation_status === 'generating' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    {project.generation_status === 'failed'
                      ? 'Failed'
                      : project.generation_status === 'incomplete'
                        ? 'Incomplete'
                        : project.generation_status === 'generating'
                          ? 'Generating'
                          : project.is_download_ready
                            ? 'ZIP ready'
                            : 'Incomplete'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-600">
                  <span>{project.file_count || 0} saved file{project.file_count === 1 ? '' : 's'}</span>
                  <span>{formatProjectDate(project.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
