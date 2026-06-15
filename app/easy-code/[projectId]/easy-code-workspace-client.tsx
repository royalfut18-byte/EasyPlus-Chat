'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Circle, Code2, Copy, Download, Eye, File, FilePlus, FolderOpen, Loader2, MessageSquare, Monitor, RefreshCw, Save, Send, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EasyCodeProject {
  id: string
  title: string
  description: string | null
  framework: string | null
  generation_status?: 'idle' | 'generating' | 'ready' | 'failed' | 'incomplete'
  generation_phase?: string | null
  generation_error?: string | null
  generation_metadata?: {
    progress?: Array<{ label: string; state: 'done' | 'active' | 'pending' }>
    filesCreated?: string[]
    lastError?: string | null
    diagnostics?: {
      providerUsed?: 'azure-gpt54' | 'azure-deepseek' | 'google' | 'fallback' | null
      fallbackUsed?: boolean
    }
  }
  updated_at: string
}

const PROVIDER_LABELS: Record<string, string> = {
  'azure-gpt54': 'GPT 5.5',
  'azure-deepseek': 'DeepSeek V4 Pro',
  google: 'Gemini 3.1 Pro',
  fallback: 'offline template',
}

function getProviderLabel(providerUsed?: string | null): string | null {
  if (!providerUsed) return null
  return PROVIDER_LABELS[providerUsed] || providerUsed
}

interface EasyCodeFile {
  id: string
  path: string
  language: string | null
  content: string
  size_bytes: number
  updated_at: string
}

interface EasyCodeMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: any
  created_at: string
}

type BuilderView = 'preview' | 'code'
type MobileTab = 'chat' | 'preview' | 'code' | 'files'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatRelativeDate(value: string): string {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Recently updated'
  const diff = Date.now() - time
  const minutes = Math.max(1, Math.round(diff / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function downloadTextFile(path: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = path.split('/').pop() || 'file.txt'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function statusClass(status: string) {
  if (status === 'failed' || status === 'incomplete') return 'bg-red-500/10 text-red-200 border-red-400/10'
  if (status === 'ready') return 'bg-emerald-500/10 text-emerald-200 border-emerald-400/10'
  return 'bg-clay-500/10 text-clay-200 border-clay-300/10'
}

export function EasyCodeWorkspaceClient({
  initialProject,
  initialFiles,
  initialMessages,
}: {
  initialProject: EasyCodeProject
  initialFiles: EasyCodeFile[]
  initialMessages: EasyCodeMessage[]
}) {
  const [project, setProject] = useState(initialProject)
  const [files, setFiles] = useState(initialFiles)
  const [messages, setMessages] = useState(initialMessages)
  const [selectedPath, setSelectedPath] = useState(initialFiles.find(file => file.path.toLowerCase() === 'index.html')?.path || initialFiles[0]?.path || '')
  const [draft, setDraft] = useState(initialFiles.find(file => file.path.toLowerCase() === 'index.html')?.content || initialFiles[0]?.content || '')
  const [chatInput, setChatInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [builderView, setBuilderView] = useState<BuilderView>('preview')
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview')
  const [previewNonce, setPreviewNonce] = useState(0)
  const initialGenerationStartedRef = useRef(false)
  const router = useRouter()

  const selectedFile = useMemo(() => files.find(file => file.path === selectedPath) || null, [files, selectedPath])
  const hasUnsavedChanges = selectedFile ? draft !== selectedFile.content : false
  const hasStaticPreview = project.framework === 'html' || (
    files.some(file => file.path.toLowerCase() === 'index.html') &&
    files.some(file => file.path.toLowerCase() === 'styles.css') &&
    files.some(file => file.path.toLowerCase() === 'script.js')
  )
  const meaningfulFiles = files.filter(file => file.path.toLowerCase() !== 'readme.md' && file.content.trim().length > 0)
  const latestAssistant = [...messages].reverse().find(message => message.role === 'assistant')
  const generationStatus = project.generation_status || (files.length > 0 ? 'ready' : 'idle')
  const isDownloadReady = generationStatus === 'ready' && meaningfulFiles.length >= 2
  const isGenerationStale = generationStatus === 'generating' &&
    project.updated_at &&
    Date.now() - new Date(project.updated_at).getTime() > 120_000
  const progressSteps = project.generation_metadata?.progress || [
    { label: 'Project created', state: 'done' as const },
    { label: 'Planning file structure', state: generationStatus === 'generating' ? 'active' as const : 'pending' as const },
    { label: 'Writing files', state: 'pending' as const },
    { label: 'Saving files', state: 'pending' as const },
    { label: 'Preparing preview', state: 'pending' as const },
  ]
  const suggestedNextSteps = [
    'Refine colours and branding',
    'Add more pricing plans',
    'Add a booking form',
    'Improve animations',
  ]

  const selectFile = (file: EasyCodeFile) => {
    setSelectedPath(file.path)
    setDraft(file.content)
    setBuilderView('code')
    setMobileTab('code')
  }

  const syncProjectData = useCallback((data: any) => {
    if (data.project) setProject(data.project)
    const nextFiles: EasyCodeFile[] = data.files || []
    setFiles(nextFiles)
    setMessages(data.messages || [])
    const nextSelected = nextFiles.find(file => file.path === selectedPath) ||
      nextFiles.find(file => file.path.toLowerCase() === 'index.html') ||
      nextFiles[0]
    if (nextSelected) {
      setSelectedPath(nextSelected.path)
      setDraft(nextSelected.content)
    }
  }, [selectedPath])

  const refreshProject = useCallback(async () => {
    const response = await fetch(`/api/easy-code/projects/${project.id}`, { cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (response.ok) syncProjectData(data)
  }, [project.id, syncProjectData])

  const generateInitialProject = useCallback(async () => {
    if (initialGenerationStartedRef.current) return
    initialGenerationStartedRef.current = true
    setIsGenerating(true)
    setError(null)
    try {
      const response = await fetch(`/api/easy-code/projects/${project.id}/generate`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Project was created but generation failed.')
      syncProjectData(data)
      setBuilderView('preview')
      setMobileTab('preview')
      setPreviewNonce(prev => prev + 1)
    } catch (error: any) {
      const message = error?.message || ''
      setError(message === 'Failed to fetch' || /aborted|timeout|timed out/i.test(message)
        ? 'The generation request timed out. Retry from the workspace.'
        : message || 'Project was created but generation failed.')
      await refreshProject().catch(() => {})
    } finally {
      setIsGenerating(false)
    }
  }, [project.id, refreshProject, syncProjectData])

  useEffect(() => {
    if (
      generationStatus === 'generating' &&
      project.generation_phase === 'creating_project' &&
      files.length === 0
    ) {
      generateInitialProject()
    }
  }, [files.length, generateInitialProject, generationStatus, project.generation_phase])

  useEffect(() => {
    if (generationStatus !== 'generating') return
    const timer = window.setInterval(() => {
      refreshProject().catch(() => {})
    }, 1500)
    return () => window.clearInterval(timer)
  }, [generationStatus, refreshProject])

  const retryGeneration = () => {
    initialGenerationStartedRef.current = false
    setBuilderView('preview')
    setMobileTab('preview')
    generateInitialProject()
  }

  const refreshPreview = async () => {
    await refreshProject().catch(() => {})
    setPreviewNonce(prev => prev + 1)
  }

  const saveFile = async () => {
    if (!selectedFile || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/easy-code/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile.path, language: selectedFile.language, content: draft }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.file) throw new Error(data.error || 'File could not be saved.')
      setFiles(prev => prev.map(file => file.path === data.file.path ? data.file : file))
      setPreviewNonce(prev => prev + 1)
    } catch (error: any) {
      setError(error?.message || 'File could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const addFile = async () => {
    const path = window.prompt('New file path, for example src/App.tsx')
    if (!path) return
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/easy-code/projects/${project.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: '' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.file) throw new Error(data.error || 'File could not be saved.')
      setFiles(prev => [...prev.filter(file => file.path !== data.file.path), data.file].sort((a, b) => a.path.localeCompare(b.path)))
      selectFile(data.file)
    } catch (error: any) {
      setError(error?.message || 'File could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const deleteFile = async () => {
    if (!selectedFile || !window.confirm(`Delete ${selectedFile.path}?`)) return
    setIsSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/easy-code/projects/${project.id}/files?path=${encodeURIComponent(selectedFile.path)}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'File could not be deleted.')
      const remaining = files.filter(file => file.path !== selectedFile.path)
      setFiles(remaining)
      const next = remaining.find(file => file.path.toLowerCase() === 'index.html') || remaining[0]
      setSelectedPath(next?.path || '')
      setDraft(next?.content || '')
      setPreviewNonce(prev => prev + 1)
    } catch (error: any) {
      setError(error?.message || 'File could not be deleted.')
    } finally {
      setIsSaving(false)
    }
  }

  const sendEasyCodeMessage = async () => {
    const clean = chatInput.trim()
    if (clean.length < 3 || isGenerating) return
    const pendingPrompt = clean
    setIsGenerating(true)
    setError(null)
    setMessages(prev => [...prev, {
      id: `local-${Date.now()}`,
      role: 'user',
      content: clean,
      created_at: new Date().toISOString(),
    }])
    setChatInput('')
    try {
      const response = await fetch('/api/easy-code/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, message: clean, selectedPath }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not apply changes.')
      syncProjectData(data)
      setBuilderView('preview')
      setMobileTab('preview')
      setPreviewNonce(prev => prev + 1)
    } catch (error: any) {
      setError(error?.message || 'Could not apply changes. Try again.')
      setChatInput(pendingPrompt)
      await refreshProject().catch(() => {})
    } finally {
      setIsGenerating(false)
    }
  }

  const PreviewPane = (
    <div className="flex h-full min-h-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#111] p-3 shadow-2xl shadow-black/25">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Live preview</p>
          <p className="truncate text-sm text-gray-300">{hasStaticPreview ? 'Static website preview' : 'Preview unavailable'}</p>
        </div>
        <button onClick={refreshPreview} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] px-3 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-[22px] border border-white/[0.08] bg-white">
        {hasStaticPreview ? (
          <iframe
            key={`${project.id}-${previewNonce}-${files.map(file => `${file.path}:${file.updated_at}`).join('|')}`}
            src={`/api/easy-code/projects/${project.id}/preview`}
            sandbox="allow-scripts"
            className="h-full w-full bg-white"
          />
        ) : generationStatus === 'generating' ? (
          <div className="flex h-full flex-col items-center justify-center bg-[#13110f] p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-clay-300" />
            <p className="mt-4 text-sm font-medium text-gray-200">Preparing preview...</p>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-gray-500">Easy Code is generating files. The preview will load automatically when an index.html file is ready.</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-[#13110f] p-8 text-center">
            <Monitor className="h-9 w-9 text-gray-600" />
            <p className="mt-4 text-sm font-medium text-gray-200">Preview unavailable for this project type.</p>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-gray-500">View code or download the ZIP to run this project locally.</p>
          </div>
        )}
      </div>
    </div>
  )

  const CodePane = (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#111] shadow-2xl shadow-black/25 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className={cn('min-h-0 border-r border-white/[0.06] bg-[#181311]', mobileTab !== 'files' && 'hidden md:block')}>
        <div className="flex items-center justify-between border-b border-white/[0.06] p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <FolderOpen className="h-4 w-4 text-clay-300" />
            Files
          </div>
          <button onClick={addFile} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white" title="Add file">
            <FilePlus className="h-4 w-4" />
          </button>
        </div>
        <div className="h-full overflow-y-auto p-2 pb-20 scrollbar-thin">
          {files.map(file => (
            <button
              key={file.path}
              onClick={() => selectFile(file)}
              className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors', selectedPath === file.path ? 'bg-clay-500/10 text-white' : 'text-gray-400 hover:bg-white/[0.045] hover:text-gray-200')}
            >
              <File className="h-3.5 w-3.5 shrink-0 text-gray-500" />
              <span className="truncate">{file.path}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className={cn('flex min-h-0 min-w-0 flex-col', mobileTab === 'files' && 'hidden md:flex')}>
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-white/[0.06] bg-[#1a1512] px-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-200">{selectedFile?.path || 'No file selected'}</p>
            <p className="text-xs text-gray-600">{selectedFile?.language || 'text'} {selectedFile ? `- ${formatBytes(selectedFile.size_bytes)}` : ''} {hasUnsavedChanges ? '- unsaved' : ''}</p>
          </div>
          {selectedFile && (
            <div className="flex items-center gap-2">
              <button onClick={() => navigator.clipboard.writeText(draft)} className="rounded-full border border-white/[0.08] p-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white" title="Copy file">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => downloadTextFile(selectedFile.path, draft)} className="rounded-full border border-white/[0.08] p-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white" title="Download file">
                <Download className="h-3.5 w-3.5" />
              </button>
              <button onClick={deleteFile} className="rounded-full border border-red-400/10 p-2 text-red-300 transition-colors hover:bg-red-500/10" title="Delete file">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={saveFile} disabled={!hasUnsavedChanges || isSaving} className="inline-flex h-9 items-center gap-2 rounded-full bg-clay-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-clay-500 disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          )}
        </div>
        {selectedFile ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-[#13110f] p-4 font-mono text-[13px] leading-6 text-gray-100 outline-none scrollbar-thin placeholder:text-gray-600"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Select or add a file.</div>
        )}
      </section>
    </div>
  )

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[#12100e] text-white">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-white/[0.06] bg-[#181311]/95 px-3 backdrop-blur md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/easy-code" className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-clay-500/10 text-clay-200">
            <Code2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-white md:text-base">{project.title}</h1>
            <p className="truncate text-xs text-gray-500">
              <span className={cn('mr-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]', statusClass(generationStatus))}>{generationStatus}</span>
              {files.length} files - updated {formatRelativeDate(project.updated_at)}
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <div className="rounded-full border border-white/[0.08] bg-[#13110f] p-1">
            <button
              onClick={() => setBuilderView('preview')}
              className={cn('inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-semibold transition-colors', builderView === 'preview' ? 'bg-white text-black' : 'text-gray-400 hover:text-white')}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              onClick={() => setBuilderView('code')}
              className={cn('inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-semibold transition-colors', builderView === 'code' ? 'bg-white text-black' : 'text-gray-400 hover:text-white')}
            >
              <Code2 className="h-3.5 w-3.5" />
              View Code
            </button>
          </div>
          {isDownloadReady ? (
            <Link href={`/api/easy-code/projects/${project.id}/download`} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-semibold text-black transition-colors hover:bg-gray-200">
              <Download className="h-3.5 w-3.5" />
              Download ZIP
            </Link>
          ) : (
            <button disabled title="Project is not ready to download yet." className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-full bg-white/40 px-4 text-xs font-semibold text-black/60">
              <Download className="h-3.5 w-3.5" />
              Download ZIP
            </button>
          )}
          <button onClick={refreshPreview} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.08] px-4 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </header>

      <div className="grid grid-cols-4 border-b border-white/[0.06] bg-[#111] p-1 md:hidden">
        {(['chat', 'preview', 'code', 'files'] as MobileTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setMobileTab(tab)
              if (tab === 'preview') setBuilderView('preview')
              if (tab === 'code' || tab === 'files') setBuilderView('code')
            }}
            className={cn('rounded-lg px-2 py-2 text-xs font-medium capitalize', mobileTab === tab ? 'bg-white/[0.08] text-white' : 'text-gray-500')}
          >
            {tab}
          </button>
        ))}
      </div>

      {error && (
        <div className="border-b border-red-400/10 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[380px_minmax(0,1fr)]">
        <aside className={cn('flex min-h-0 flex-col border-r border-white/[0.06] bg-[#181311]', mobileTab !== 'chat' && 'hidden md:flex')}>
          <div className="border-b border-white/[0.06] p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-clay-500/10 text-clay-200">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Easy Code builder</p>
                <p className="text-xs text-gray-500">{generationStatus === 'ready' ? 'Ready for edits' : 'Building project'}</p>
              </div>
            </div>
            {latestAssistant?.content ? (
              <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Latest summary</p>
                <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-gray-200">{latestAssistant.content}</p>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
            <div className="rounded-2xl border border-white/[0.07] bg-[#13110f] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Build progress</p>
                <span className={cn('rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]', statusClass(generationStatus))}>{generationStatus}</span>
              </div>
              <div className="mt-3 space-y-2">
                {progressSteps.map(step => (
                  <div key={step.label} className="flex items-center gap-2 text-xs text-gray-300">
                    {step.state === 'done' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                    ) : step.state === 'active' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-clay-300" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-gray-700" />
                    )}
                    <span>{step.label}</span>
                  </div>
                ))}
              </div>
              {(() => {
                const providerUsed = project.generation_metadata?.diagnostics?.providerUsed
                const providerLabel = getProviderLabel(providerUsed)
                if (!providerLabel || generationStatus !== 'ready') return null
                const onGpt = providerUsed === 'azure-gpt54'
                return (
                  <div className="mt-3 flex items-center gap-2 text-[11px]">
                    <span className="text-gray-500">Built with</span>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold',
                      onGpt
                        ? 'border-clay-400/20 bg-clay-500/10 text-clay-200'
                        : 'border-amber-400/20 bg-amber-500/10 text-amber-200'
                    )}>
                      <Sparkles className="h-3 w-3" />
                      {providerLabel}
                    </span>
                    {!onGpt && <span className="text-gray-600">GPT was unavailable</span>}
                  </div>
                )
              })()}
              {project.generation_metadata?.filesCreated?.length ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {project.generation_metadata.filesCreated.slice(0, 10).map(path => (
                    <span key={path} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-gray-400">{path}</span>
                  ))}
                </div>
              ) : null}
              {(generationStatus === 'failed' || generationStatus === 'incomplete' || isGenerationStale) && (
                <button onClick={retryGeneration} className="mt-3 inline-flex items-center gap-2 rounded-full bg-clay-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-clay-500">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry generation
                </button>
              )}
              {isGenerationStale && (
                <p className="mt-2 text-xs text-amber-200">Generation appears stuck. Retry will reuse this project.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/[0.07] bg-[#13110f] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">What&apos;s next?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestedNextSteps.map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => setChatInput(suggestion)}
                    className="rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-clay-300/20 hover:bg-clay-500/10 hover:text-white"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {messages.length === 0 ? (
              <p className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 text-sm text-gray-500">Ask Easy Code to change anything in this project.</p>
            ) : messages.map(message => (
              <div key={message.id} className={cn('rounded-2xl p-3 text-sm', message.role === 'user' ? 'bg-clay-600/15 text-clay-50' : 'bg-white/[0.04] text-gray-200')}>
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                {message.role === 'assistant' && Array.isArray(message.metadata?.changedFiles) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.metadata.changedFiles.slice(0, 6).map((file: any) => (
                      <span key={`${file.operation}-${file.path}`} className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] text-gray-400">{file.operation}: {file.path}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isGenerating && (
              <div className="rounded-2xl border border-clay-300/10 bg-clay-500/10 p-3 text-sm text-clay-100">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-clay-200" />
                  <span>{generationStatus === 'generating' ? 'Building project...' : 'Applying changes...'}</span>
                </div>
                <div className="mt-3 grid gap-1 text-xs text-clay-100/70">
                  <span>Reading project files...</span>
                  <span>Planning changes...</span>
                  <span>Updating files...</span>
                  <span>Refreshing preview...</span>
                </div>
              </div>
            )}

            {latestAssistant?.metadata?.instructions?.length ? (
              <div className="rounded-2xl border border-white/[0.07] bg-[#13110f] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Run instructions</p>
                <ul className="mt-2 space-y-1 text-xs text-gray-300">
                  {latestAssistant.metadata.instructions.map((item: string) => <li key={item}>- {item}</li>)}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/[0.06] p-3">
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  sendEasyCodeMessage()
                }
              }}
              disabled={isGenerating}
              rows={3}
              placeholder="Ask Easy Code to change anything..."
              className="w-full resize-none rounded-2xl border border-white/[0.08] bg-[#13110f] p-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-clay-300/25 disabled:opacity-60"
            />
            <button
              onClick={sendEasyCodeMessage}
              disabled={chatInput.trim().length < 3 || isGenerating}
              className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-clay-600 text-sm font-semibold text-white transition-colors hover:bg-clay-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Apply changes
            </button>
          </div>
        </aside>

        <section className={cn('min-h-0 bg-[#12100e] p-3 md:p-4', mobileTab === 'chat' && 'hidden md:block')}>
          <div className="mb-3 flex items-center justify-between gap-3 md:hidden">
            {isDownloadReady ? (
              <Link href={`/api/easy-code/projects/${project.id}/download`} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-black">
                <Download className="h-3.5 w-3.5" />
                Download ZIP
              </Link>
            ) : (
              <button disabled className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-full bg-white/40 px-3 text-xs font-semibold text-black/60">
                <Download className="h-3.5 w-3.5" />
                Download ZIP
              </button>
            )}
            <button onClick={refreshPreview} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] px-3 text-xs font-semibold text-gray-300">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
          <div className="h-full min-h-0">
            {builderView === 'preview' ? PreviewPane : CodePane}
          </div>
        </section>
      </div>
    </main>
  )
}
