'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Circle, Code2, Copy, Download, File, FilePlus, FolderOpen, Loader2, MessageSquare, Monitor, RefreshCw, Save, Send, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EasyCodeProject {
  id: string
  title: string
  description: string | null
  framework: string | null
  generation_status?: 'idle' | 'generating' | 'ready' | 'failed'
  generation_phase?: string | null
  generation_error?: string | null
  generation_metadata?: {
    progress?: Array<{ label: string; state: 'done' | 'active' | 'pending' }>
    filesCreated?: string[]
    lastError?: string | null
  }
  updated_at: string
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

type MobileTab = 'files' | 'chat' | 'preview'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
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
  const [selectedPath, setSelectedPath] = useState(initialFiles[0]?.path || '')
  const [draft, setDraft] = useState(initialFiles[0]?.content || '')
  const [chatInput, setChatInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<MobileTab>('files')
  const initialGenerationStartedRef = useRef(false)
  const router = useRouter()

  const selectedFile = useMemo(() => files.find(file => file.path === selectedPath) || null, [files, selectedPath])
  const hasUnsavedChanges = selectedFile ? draft !== selectedFile.content : false
  const hasStaticPreview = files.some(file => file.path.toLowerCase() === 'index.html')
  const latestAssistant = [...messages].reverse().find(message => message.role === 'assistant')
  const generationStatus = project.generation_status || (files.length > 0 ? 'ready' : 'idle')
  const progressSteps = project.generation_metadata?.progress || [
    { label: 'Project created', state: 'done' as const },
    { label: 'Planning file structure', state: generationStatus === 'generating' ? 'active' as const : 'pending' as const },
    { label: 'Writing files', state: 'pending' as const },
    { label: 'Saving files', state: 'pending' as const },
    { label: 'Preparing preview', state: 'pending' as const },
  ]

  const selectFile = (file: EasyCodeFile) => {
    setSelectedPath(file.path)
    setDraft(file.content)
    setActiveTab('files')
  }

  const refreshProject = async () => {
    const response = await fetch(`/api/easy-code/projects/${project.id}`, { cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (response.ok) {
      if (data.project) setProject(data.project)
      setFiles(data.files || [])
      setMessages(data.messages || [])
      const nextSelected = data.files?.find((file: EasyCodeFile) => file.path === selectedPath) || data.files?.[0]
      if (nextSelected) {
        setSelectedPath(nextSelected.path)
        setDraft(nextSelected.content)
      }
    }
  }

  const generateInitialProject = async () => {
    if (initialGenerationStartedRef.current) return
    initialGenerationStartedRef.current = true
    setIsGenerating(true)
    setError(null)
    try {
      const response = await fetch(`/api/easy-code/projects/${project.id}/generate`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Project was created but generation failed.')
      if (data.project) setProject(data.project)
      setFiles(data.files || [])
      setMessages(data.messages || [])
      const firstFile = data.files?.[0]
      if (firstFile) {
        setSelectedPath(firstFile.path)
        setDraft(firstFile.content)
      }
    } catch (error: any) {
      setError(error?.message === 'Failed to fetch'
        ? 'The generation request timed out. Retry from the workspace.'
        : error?.message || 'Project was created but generation failed.')
      await refreshProject().catch(() => {})
    } finally {
      setIsGenerating(false)
    }
  }

  useEffect(() => {
    if (
      generationStatus === 'generating' &&
      project.generation_phase === 'creating_project' &&
      files.length === 0
    ) {
      generateInitialProject()
    }
  }, [files.length, generationStatus, project.generation_phase])

  useEffect(() => {
    if (generationStatus !== 'generating') return
    const timer = window.setInterval(() => {
      refreshProject().catch(() => {})
    }, 1500)
    return () => window.clearInterval(timer)
  }, [generationStatus, project.id, selectedPath])

  const retryGeneration = () => {
    initialGenerationStartedRef.current = false
    generateInitialProject()
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
      const next = remaining[0]
      setSelectedPath(next?.path || '')
      setDraft(next?.content || '')
    } catch (error: any) {
      setError(error?.message || 'File could not be deleted.')
    } finally {
      setIsSaving(false)
    }
  }

  const sendEasyCodeMessage = async () => {
    const clean = chatInput.trim()
    if (clean.length < 3 || isGenerating) return
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
      if (!response.ok) throw new Error(data.error || 'Could not generate files.')
      setFiles(data.files || [])
      setMessages(data.messages || [])
      const changedPath = data.aiResult?.files?.[0]?.newPath || data.aiResult?.files?.[0]?.path
      const nextSelected = (data.files || []).find((file: EasyCodeFile) => file.path === changedPath) ||
        (data.files || []).find((file: EasyCodeFile) => file.path === selectedPath) ||
        (data.files || [])[0]
      if (nextSelected) {
        setSelectedPath(nextSelected.path)
        setDraft(nextSelected.content)
      }
      setActiveTab('files')
    } catch (error: any) {
      setError(error?.message || 'Could not generate files.')
      await refreshProject().catch(() => {})
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[#0f0f0f] text-white">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/[0.06] bg-[#151515] px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/easy-code" className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-200">
            <Code2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-white md:text-base">{project.title}</h1>
            <p className="truncate text-xs text-gray-500">{project.framework || 'Easy Code project'} · {files.length} files</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/api/easy-code/projects/${project.id}/download`} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-gray-200">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Download ZIP</span>
          </Link>
          <button onClick={() => router.refresh()} className="hidden rounded-full border border-white/[0.08] px-3 py-2 text-xs text-gray-300 transition-colors hover:bg-white/[0.06] md:inline-flex">
            Refresh
          </button>
        </div>
      </header>

      <div className="flex border-b border-white/[0.06] bg-[#111] p-1 md:hidden">
        {(['files', 'chat', 'preview'] as MobileTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-medium capitalize', activeTab === tab ? 'bg-white/[0.08] text-white' : 'text-gray-500')}
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className={cn('min-h-0 border-r border-white/[0.06] bg-[#151515]', activeTab !== 'files' && 'hidden md:block')}>
          <div className="flex items-center justify-between border-b border-white/[0.06] p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
              <FolderOpen className="h-4 w-4 text-violet-300" />
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
                className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors', selectedPath === file.path ? 'bg-violet-500/10 text-white' : 'text-gray-400 hover:bg-white/[0.045] hover:text-gray-200')}
              >
                <File className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                <span className="truncate">{file.path}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className={cn('flex min-h-0 min-w-0 flex-col', activeTab !== 'files' && 'hidden md:flex')}>
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-white/[0.06] bg-[#171717] px-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-200">{selectedFile?.path || 'No file selected'}</p>
              <p className="text-xs text-gray-600">{selectedFile?.language || 'text'} {selectedFile ? `· ${formatBytes(selectedFile.size_bytes)}` : ''} {hasUnsavedChanges ? '· unsaved' : ''}</p>
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
                <button onClick={saveFile} disabled={!hasUnsavedChanges || isSaving} className="inline-flex h-9 items-center gap-2 rounded-full bg-violet-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50">
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
              className="min-h-0 flex-1 resize-none bg-[#101010] p-4 font-mono text-[13px] leading-6 text-gray-100 outline-none scrollbar-thin placeholder:text-gray-600"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Select or add a file.</div>
          )}
        </section>

        <aside className={cn('grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(240px,42vh)] border-l border-white/[0.06] bg-[#151515]', activeTab === 'files' && 'hidden md:grid', activeTab === 'chat' && 'grid grid-rows-1 md:grid-rows-[minmax(0,1fr)_minmax(240px,42vh)]', activeTab === 'preview' && 'grid grid-rows-1 md:grid-rows-[minmax(0,1fr)_minmax(240px,42vh)]')}>
          <div className={cn('min-h-0 border-b border-white/[0.06]', activeTab === 'chat' && 'hidden md:block')}>
            <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <Monitor className="h-4 w-4 text-pink-300" />
                Preview
              </div>
            </div>
            {hasStaticPreview ? (
              <iframe
                key={`${project.id}-${files.map(file => `${file.path}:${file.updated_at}`).join('|')}`}
                src={`/api/easy-code/projects/${project.id}/preview`}
                sandbox="allow-scripts"
                className="h-full w-full bg-white"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-5 text-center">
                <Monitor className="h-8 w-8 text-gray-600" />
                <p className="mt-3 text-sm font-medium text-gray-300">Preview unavailable for this project type.</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">Download the project to run React, Next.js, Node, or Python projects locally.</p>
              </div>
            )}
          </div>

          <div className={cn('flex min-h-0 flex-col', activeTab === 'preview' && 'hidden md:flex')}>
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-sm font-medium text-gray-200">
              <MessageSquare className="h-4 w-4 text-violet-300" />
              Ask Easy Code
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
              <div className="rounded-2xl border border-white/[0.07] bg-[#101010] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Build progress</p>
                  <span className={cn(
                    'rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
                    generationStatus === 'failed'
                      ? 'bg-red-500/10 text-red-200'
                      : generationStatus === 'ready'
                        ? 'bg-emerald-500/10 text-emerald-200'
                        : 'bg-violet-500/10 text-violet-200'
                  )}>
                    {generationStatus}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {progressSteps.map(step => (
                    <div key={step.label} className="flex items-center gap-2 text-xs text-gray-300">
                      {step.state === 'done' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                      ) : step.state === 'active' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-gray-700" />
                      )}
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
                {project.generation_metadata?.filesCreated?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {project.generation_metadata.filesCreated.slice(0, 10).map(path => (
                      <span key={path} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-gray-400">{path}</span>
                    ))}
                  </div>
                ) : null}
                {generationStatus === 'failed' && (
                  <button onClick={retryGeneration} className="mt-3 inline-flex items-center gap-2 rounded-full bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry generation
                  </button>
                )}
              </div>
              {messages.length === 0 ? (
                <p className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 text-sm text-gray-500">Ask for changes, bug fixes, new files, or README improvements.</p>
              ) : messages.map(message => (
                <div key={message.id} className={cn('rounded-2xl p-3 text-sm', message.role === 'user' ? 'bg-violet-600/15 text-violet-50' : 'bg-white/[0.04] text-gray-200')}>
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
                <div className="flex items-center gap-2 rounded-2xl bg-white/[0.04] p-3 text-sm text-gray-300">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                  {project.generation_phase === 'creating_project'
                    ? 'Creating project...'
                    : project.generation_phase === 'planning'
                      ? 'Planning file structure...'
                      : project.generation_phase === 'saving_files'
                        ? 'Saving files...'
                        : project.generation_phase === 'building_preview'
                          ? 'Preparing preview...'
                          : 'DeepSeek is editing project files...'}
                </div>
              )}
              {latestAssistant?.metadata?.instructions?.length ? (
                <div className="rounded-2xl border border-white/[0.07] bg-[#101010] p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Run instructions</p>
                  <ul className="mt-2 space-y-1 text-xs text-gray-300">
                    {latestAssistant.metadata.instructions.map((item: string) => <li key={item}>• {item}</li>)}
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
                placeholder="Make it more premium and add a pricing section..."
                className="w-full resize-none rounded-2xl border border-white/[0.08] bg-[#101010] p-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-violet-300/25 disabled:opacity-60"
              />
              <button
                onClick={sendEasyCodeMessage}
                disabled={chatInput.trim().length < 3 || isGenerating}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Apply with DeepSeek
              </button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
