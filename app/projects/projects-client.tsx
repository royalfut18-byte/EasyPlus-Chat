'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Trash2, FolderOpen, MessageSquare, Plus, Search, Upload, Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'

type ProjectCard = {
  id: string
  name: string
  description?: string | null
  instructions?: string | null
  updated_at: string
  stats?: {
    chatCount: number
    fileCount: number
    artifactCount: number
    memoryCount: number
  }
}

export function ProjectsClient({ initialProjects }: { initialProjects: ProjectCard[] }) {
  const [projects, setProjects] = useState(initialProjects)
  const [query, setQuery] = useState('')
  const [statsLoaded, setStatsLoaded] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', instructions: '' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/projects?view=stats')
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!cancelled && data?.projects) {
          setProjects(data.projects)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setStatsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const filteredProjects = projects.filter(project =>
    `${project.name} ${project.description || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  )

  const createProject = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Project name is required', variant: 'destructive' })
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create project')
      setProjects(prev => [{ ...data.project, stats: { chatCount: 0, fileCount: 0, artifactCount: 0, memoryCount: 0 } }, ...prev])
      setForm({ name: '', description: '', instructions: '' })
      setIsCreateOpen(false)
      toast({ title: 'Project created' })
    } catch (error: any) {
      toast({ title: 'Could not create project', description: error.message, variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  const deleteProject = async (id: string) => {
    if (!window.confirm('Delete this project permanently? All chats, files, and memory will be deleted. This cannot be undone.')) return

    try {
      const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to delete project')
      setProjects(prev => prev.filter(project => project.id !== id))
      toast({ title: 'Project deleted' })
    } catch (error: any) {
      toast({ title: 'Could not delete project', description: error.message, variant: 'destructive' })
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-violet-300">Workspace memory</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Projects</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-400">
            Long-term AI workspaces with their own chats, instructions, files, and memory.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="rounded-lg bg-violet-600 text-white hover:bg-violet-500">
          <Plus className="mr-2 h-4 w-4" />
          Create Project
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-500" />
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search projects" className="pl-9" />
        </div>
      )}

      {projects.length === 0 ? (
        <section className="rounded-2xl border border-white/[0.08] bg-[#181818] p-10 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-gray-600" />
          <h2 className="mt-4 text-xl font-semibold text-white">No projects yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Create a project for study, client work, coding, essays, or any workflow where the AI should remember context.
          </p>
          <Button onClick={() => setIsCreateOpen(true)} className="mt-5 bg-violet-600 text-white hover:bg-violet-500">
            Create your first project
          </Button>
        </section>
      ) : filteredProjects.length === 0 ? (
        <section className="rounded-2xl border border-white/[0.08] bg-[#181818] p-8 text-center">
          <Search className="mx-auto h-8 w-8 text-gray-600" />
          <h2 className="mt-3 text-lg font-semibold text-white">No matching projects</h2>
          <p className="mt-1 text-sm text-gray-500">Try a different name or description.</p>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map(project => (
            <article key={project.id} className="group rounded-2xl border border-white/[0.08] bg-[#181818] p-5 transition-colors hover:border-white/[0.14] hover:bg-[#1d1d1d]">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/15 bg-violet-500/10">
                      <FolderOpen className="h-5 w-5 text-violet-300" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-white">{project.name}</h2>
                      <p className="text-xs text-gray-500">Updated {formatDate(project.updated_at)}</p>
                    </div>
                  </div>
                  <p className="mt-4 line-clamp-2 min-h-[40px] text-sm leading-5 text-gray-400">
                    {project.description || 'No description yet.'}
                  </p>
                </Link>
                <button
                  onClick={() => deleteProject(project.id)}
                  className="rounded-lg p-2 text-gray-500 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                  title="Delete project"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <Metric href={`/projects/${project.id}?tab=chats`} icon={<MessageSquare />} label="Chats" value={statsLoaded ? project.stats?.chatCount || 0 : null} />
                <Metric href={`/projects/${project.id}?tab=files`} icon={<Upload />} label="Files" value={statsLoaded ? project.stats?.fileCount || 0 : null} />
                <Metric href={`/projects/${project.id}?tab=artifacts`} icon={<Search />} label="Artifacts" value={statsLoaded ? project.stats?.artifactCount || 0 : null} />
                <Metric href={`/projects/${project.id}?tab=memory`} icon={<Brain />} label="Memory" value={statsLoaded ? project.stats?.memoryCount || 0 : null} />
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="border-white/[0.08] bg-[#181818] text-white">
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>Create a workspace with dedicated instructions, chats, files, and memory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input id="project-name" value={form.name} onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} placeholder="HSC Economics" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">Description</Label>
              <textarea
                id="project-description"
                value={form.description}
                onChange={event => setForm(prev => ({ ...prev, description: event.target.value }))}
                placeholder="What is this workspace for?"
                className="min-h-20 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-violet-500/30"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-instructions">Project instructions</Label>
              <textarea
                id="project-instructions"
                value={form.instructions}
                onChange={event => setForm(prev => ({ ...prev, instructions: event.target.value }))}
                placeholder="Use Australian spelling. Answer in Band 6 style."
                className="min-h-24 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-violet-500/30"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={createProject} disabled={isSaving} className="bg-violet-600 text-white hover:bg-violet-500">
              {isSaving ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Metric({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: number | null }) {
  const labelText = value === 1 && label !== 'Memory' ? label.slice(0, -1) : label

  return (
    <Link
      href={href}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-2.5 text-[11px] leading-none text-gray-400 transition-colors hover:border-violet-400/20 hover:bg-violet-500/[0.06] hover:text-gray-200"
    >
      <span className="h-4 w-4 shrink-0 text-violet-300/80">{icon}</span>
      <span className="font-medium text-gray-200">{value ?? '-'}</span>
      <span>{labelText.toLowerCase()}</span>
    </Link>
  )
}
