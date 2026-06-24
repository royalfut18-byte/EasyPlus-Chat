'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Brain, Check, Download, Edit3, FileText, FolderOpen, MessageSquare, PanelRightOpen, Plus, Settings, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'

type Project = {
  id: string
  name: string
  description?: string | null
  instructions?: string | null
  updated_at: string
}

type Conversation = {
  id: string
  title: string
  updated_at: string
  created_at: string
}

type ProjectMemory = {
  id: string
  title?: string | null
  content: string
  memory_type?: string | null
  importance: number
  updated_at: string
  source_type?: string | null
}

type ProjectFile = {
  id: string
  file_name?: string | null
  file_type?: string | null
  mime_type?: string | null
  public_url?: string | null
  processing_status?: string | null
  ocr_status?: string | null
  created_at: string
  important_details?: Record<string, any> | null
}

type ProjectArtifact = {
  id: string
  title: string
  language: string
  explanation?: string | null
  created_at: string
  updated_at: string
  conversation_id?: string | null
}

type Tab = 'overview' | 'chats' | 'files' | 'memory' | 'instructions' | 'artifacts' | 'settings'

export function ProjectWorkspaceClient({
  project: initialProject,
  conversations: initialConversations,
  files: initialFiles,
  memories: initialMemories,
  artifacts,
  initialTab,
}: {
  project: Project
  conversations: Conversation[]
  files: ProjectFile[]
  memories: ProjectMemory[]
  artifacts: ProjectArtifact[]
  initialTab?: string
}) {
  const router = useRouter()
  const [project, setProject] = useState(initialProject)
  const [conversations] = useState(initialConversations)
  const [files] = useState(initialFiles)
  const [memories, setMemories] = useState(initialMemories)
  const [tab, setTab] = useState<Tab>(
    (['overview', 'chats', 'files', 'memory', 'instructions', 'artifacts', 'settings'] as string[]).includes(initialTab || '')
      ? initialTab as Tab
      : 'overview'
  )
  const [isSavingProject, setIsSavingProject] = useState(false)
  const [projectForm, setProjectForm] = useState({
    name: initialProject.name,
    description: initialProject.description || '',
    instructions: initialProject.instructions || '',
  })
  const [memoryForm, setMemoryForm] = useState({ title: '', content: '', memory_type: 'fact', importance: 3 })
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingMemoryContent, setEditingMemoryContent] = useState('')

  const recentConversations = conversations.slice(0, 5)
  const recentFiles = files.slice(0, 5)
  const importantMemories = useMemo(
    () => memories.slice().sort((a, b) => b.importance - a.importance).slice(0, 5),
    [memories]
  )

  const createMemory = async () => {
    if (!memoryForm.content.trim()) {
      toast({ title: 'Memory content is required', variant: 'destructive' })
      return
    }

    try {
      const response = await fetch(`/api/projects/${project.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memoryForm),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to add memory')
      setMemories(prev => [data.memory, ...prev])
      setMemoryForm({ title: '', content: '', memory_type: 'fact', importance: 3 })
      toast({ title: 'Project memory added' })
    } catch (error: any) {
      toast({ title: 'Could not add memory', description: error.message, variant: 'destructive' })
    }
  }

  const updateMemory = async (memoryId: string) => {
    if (!editingMemoryContent.trim()) return
    try {
      const response = await fetch(`/api/projects/${project.id}/memories/${memoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editingMemoryContent }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update memory')
      setMemories(prev => prev.map(memory => memory.id === memoryId ? data.memory : memory))
      setEditingMemoryId(null)
      setEditingMemoryContent('')
      toast({ title: 'Project memory updated' })
    } catch (error: any) {
      toast({ title: 'Could not update memory', description: error.message, variant: 'destructive' })
    }
  }

  const archiveMemory = async (memoryId: string) => {
    try {
      const response = await fetch(`/api/projects/${project.id}/memories/${memoryId}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to archive memory')
      setMemories(prev => prev.filter(memory => memory.id !== memoryId))
      toast({ title: 'Project memory archived' })
    } catch (error: any) {
      toast({ title: 'Could not archive memory', description: error.message, variant: 'destructive' })
    }
  }

  const saveProject = async () => {
    if (!projectForm.name.trim()) {
      toast({ title: 'Project name is required', variant: 'destructive' })
      return
    }

    setIsSavingProject(true)
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectForm),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update project')
      setProject(data.project)
      toast({ title: 'Project updated' })
    } catch (error: any) {
      toast({ title: 'Could not update project', description: error.message, variant: 'destructive' })
    } finally {
      setIsSavingProject(false)
    }
  }

  const deleteProject = async () => {
    if (!window.confirm('Delete this project permanently? All chats, files, and memories will be permanently deleted. This cannot be undone.')) return
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to delete project')
      toast({ title: 'Project deleted' })
      router.push('/projects')
    } catch (error: any) {
      toast({ title: 'Could not delete project', description: error.message, variant: 'destructive' })
    }
  }

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab)
    router.replace(`/projects/${project.id}?tab=${nextTab}`, { scroll: false })
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-clay-400/15 bg-clay-500/10">
                <FolderOpen className="h-5 w-5 text-clay-300" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-semibold text-white">{project.name}</h1>
                <p className="mt-1 text-xs text-gray-500">Updated {formatDate(project.updated_at)}</p>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm text-gray-400">{project.description || 'No description yet.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/chat?projectId=${project.id}`}>
              <Button className="bg-clay-600 text-white hover:bg-clay-500">
                <Plus className="mr-2 h-4 w-4" />
                New chat in project
              </Button>
            </Link>
            <Button variant="ghost" className="border border-white/[0.08] bg-white/[0.02]" onClick={() => selectTab('settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </div>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#1b1613] p-1">
        {(['overview', 'chats', 'files', 'memory', 'instructions', 'artifacts', 'settings'] as Tab[]).map(item => (
          <button
            key={item}
            onClick={() => selectTab(item)}
            className={`rounded-lg px-3 py-2 text-sm capitalize transition-colors ${tab === item ? 'bg-white/[0.08] text-white' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'}`}
          >
            {item}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <OverviewCard icon={<MessageSquare />} title="Recent chats" empty="No project chats yet." items={recentConversations.map(chat => ({ id: chat.id, title: chat.title, detail: formatDate(chat.updated_at), href: `/chat?projectId=${project.id}&conversationId=${chat.id}` }))} />
          <OverviewCard icon={<Upload />} title="Recent files" empty="No project files yet." items={recentFiles.map(file => ({ id: file.id, title: file.file_name || 'Untitled file', detail: file.processing_status || file.mime_type || 'File' }))} />
          <OverviewCard icon={<Brain />} title="Important memory" empty="No project memory yet." items={importantMemories.map(memory => ({ id: memory.id, title: memory.title || memory.memory_type || 'Memory', detail: memory.content }))} />
          <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5 lg:col-span-3">
            <h2 className="text-lg font-semibold text-white">Project instructions</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-400">{project.instructions || 'No project instructions yet.'}</p>
          </section>
        </div>
      )}

      {tab === 'chats' && (
        <Panel title="Project chats" icon={<MessageSquare />}>
          <div className="space-y-2">
            {conversations.length ? conversations.map(chat => (
              <Link key={chat.id} href={`/chat?projectId=${project.id}&conversationId=${chat.id}`} className="block rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 transition-colors hover:bg-white/[0.05]">
                <p className="font-medium text-white">{chat.title}</p>
                <p className="mt-1 text-xs text-gray-500">{formatDate(chat.updated_at)}</p>
              </Link>
            )) : <EmptyText>No project chats yet. Start one from the header.</EmptyText>}
          </div>
        </Panel>
      )}

      {tab === 'files' && (
        <Panel title="Project files" icon={<Upload />}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
            <p className="text-sm text-gray-400">Upload a file inside a project chat so it is linked to this workspace and available to its memory.</p>
            <Link href={`/chat?projectId=${project.id}`}>
              <Button size="sm" className="bg-clay-600 text-white hover:bg-clay-500">
                <Upload className="mr-2 h-4 w-4" />
                Upload in project chat
              </Button>
            </Link>
          </div>
          <div className="space-y-2">
            {files.length ? files.map(file => (
              <div key={file.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-clay-300" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{file.file_name || 'Untitled file'}</p>
                    <p className="mt-1 text-xs text-gray-500">{file.mime_type || file.file_type || 'File'} · {formatDate(file.created_at)}</p>
                    {(file.processing_status || file.ocr_status) && <p className="mt-1 text-xs text-gray-500">Status: {file.processing_status || file.ocr_status}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <a href={`/api/attachments/file?attachmentId=${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-gray-300 hover:bg-white/[0.05]" title="Open file">
                    Open
                  </a>
                  <a href={`/api/attachments/file?attachmentId=${encodeURIComponent(file.id)}&download=1`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-gray-300 hover:bg-white/[0.05]" title="Download file">
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
            )) : <EmptyText>No files have been saved to this project yet. Upload files inside a project chat.</EmptyText>}
          </div>
        </Panel>
      )}

      {tab === 'memory' && (
        <Panel title="Project memory" icon={<Brain />}>
          <div className="mb-5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input value={memoryForm.title} onChange={event => setMemoryForm(prev => ({ ...prev, title: event.target.value }))} placeholder="Title" />
              <Input value={memoryForm.memory_type} onChange={event => setMemoryForm(prev => ({ ...prev, memory_type: event.target.value }))} placeholder="Type" />
              <Input type="number" min={1} max={5} value={memoryForm.importance} onChange={event => setMemoryForm(prev => ({ ...prev, importance: Number(event.target.value) }))} placeholder="Importance" />
            </div>
            <textarea
              value={memoryForm.content}
              onChange={event => setMemoryForm(prev => ({ ...prev, content: event.target.value }))}
              placeholder="Add a durable project fact, preference, decision, or instruction."
              className="mt-3 min-h-24 w-full resize-none rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-clay-500/30"
            />
            <Button onClick={createMemory} className="mt-3 bg-clay-600 text-white hover:bg-clay-500">Add memory</Button>
          </div>

          <div className="space-y-2">
            {memories.length ? memories.map(memory => (
              <div key={memory.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                {editingMemoryId === memory.id ? (
                  <div className="space-y-3">
                    <textarea value={editingMemoryContent} onChange={event => setEditingMemoryContent(event.target.value)} className="min-h-24 w-full resize-none rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-clay-500/30" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateMemory(memory.id)}><Check className="h-4 w-4" />Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingMemoryId(null)}><X className="h-4 w-4" />Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{memory.title || 'Project memory'}</p>
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-gray-400">{memory.memory_type || 'fact'}</span>
                        <span className="text-xs text-gray-500">Importance {memory.importance}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-300">{memory.content}</p>
                      <p className="mt-2 text-xs text-gray-500">Updated {formatDate(memory.updated_at)}</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setEditingMemoryId(memory.id); setEditingMemoryContent(memory.content) }} className="rounded-lg p-2 text-gray-500 hover:bg-white/[0.06] hover:text-white"><Edit3 className="h-4 w-4" /></button>
                      <button onClick={() => archiveMemory(memory.id)} className="rounded-lg p-2 text-gray-500 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                )}
              </div>
            )) : <EmptyText>No project memory yet. Important details from project chats and files will appear here.</EmptyText>}
          </div>
        </Panel>
      )}

      {tab === 'instructions' && (
        <ProjectSettingsForm projectForm={projectForm} setProjectForm={setProjectForm} saveProject={saveProject} isSavingProject={isSavingProject} instructionsOnly />
      )}

      {tab === 'artifacts' && (
        <Panel title="Project artifacts" icon={<PanelRightOpen />}>
          <div className="space-y-2">
            {artifacts.length ? artifacts.map(artifact => (
              <div key={artifact.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                <div>
                  <p className="font-medium text-white">{artifact.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{artifact.language} · {formatDate(artifact.updated_at)}</p>
                  {artifact.explanation && <p className="mt-2 text-sm text-gray-400">{artifact.explanation}</p>}
                </div>
                {artifact.conversation_id && (
                  <Link href={`/chat?projectId=${project.id}&conversationId=${artifact.conversation_id}`} className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm text-gray-300 hover:bg-white/[0.05]">
                    Open chat
                  </Link>
                )}
              </div>
            )) : <EmptyText>No project artifacts yet. Create one inside a project chat with Artifacts enabled.</EmptyText>}
          </div>
        </Panel>
      )}

      {tab === 'settings' && (
        <Panel title="Project settings" icon={<Settings />}>
          <ProjectSettingsForm projectForm={projectForm} setProjectForm={setProjectForm} saveProject={saveProject} isSavingProject={isSavingProject} />
          <div className="mt-6 border-t border-white/[0.08] pt-5">
            <Button onClick={deleteProject} variant="ghost" className="border border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Project
            </Button>
          </div>
        </Panel>
      )}
    </div>
  )
}

function ProjectSettingsForm({
  projectForm,
  setProjectForm,
  saveProject,
  isSavingProject,
  instructionsOnly = false,
}: {
  projectForm: { name: string; description: string; instructions: string }
  setProjectForm: React.Dispatch<React.SetStateAction<{ name: string; description: string; instructions: string }>>
  saveProject: () => void
  isSavingProject: boolean
  instructionsOnly?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
      <div className="space-y-4">
        {!instructionsOnly && (
          <>
            <div className="space-y-2">
              <Label>Project name</Label>
              <Input value={projectForm.name} onChange={event => setProjectForm(prev => ({ ...prev, name: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <textarea value={projectForm.description} onChange={event => setProjectForm(prev => ({ ...prev, description: event.target.value }))} className="min-h-24 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-clay-500/30" />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label>Project instructions</Label>
          <textarea value={projectForm.instructions} onChange={event => setProjectForm(prev => ({ ...prev, instructions: event.target.value }))} className="min-h-40 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-clay-500/30" placeholder="Instructions used in every project chat." />
        </div>
        <Button onClick={saveProject} disabled={isSavingProject} className="bg-clay-600 text-white hover:bg-clay-500">{isSavingProject ? 'Saving...' : 'Save changes'}</Button>
      </div>
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#1b1613] p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-5 w-5 text-clay-300">{icon}</span>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function OverviewCard({ icon, title, empty, items }: { icon: React.ReactNode; title: string; empty: string; items: Array<{ id: string; title: string; detail: string; href?: string }> }) {
  return (
    <Panel title={title} icon={icon}>
      <div className="space-y-2">
        {items.length ? items.map(item => {
          const content = (
            <>
              <p className="line-clamp-1 font-medium text-white">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-gray-500">{item.detail}</p>
            </>
          )
          return item.href ? (
            <Link key={item.id} href={item.href} className="block rounded-lg border border-white/[0.06] bg-white/[0.025] p-3 hover:bg-white/[0.05]">{content}</Link>
          ) : (
            <div key={item.id} className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">{content}</div>
          )
        }) : <EmptyText>{empty}</EmptyText>}
      </div>
    </Panel>
  )
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-gray-500">{children}</p>
}
