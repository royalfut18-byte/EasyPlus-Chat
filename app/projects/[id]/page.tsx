import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getProjectArtifacts, getProjectConversations, getProjectFiles, getProjectForUser, getProjectMemories } from '@/lib/projects.server'
import { ProjectWorkspaceClient } from './project-workspace-client'

export default async function ProjectWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params
  const { tab } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const project = await getProjectForUser(id, user.id)
  if (!project || project.archived_at) notFound()

  const [conversations, files, memories, artifacts] = await Promise.all([
    getProjectConversations(id, user.id),
    getProjectFiles(id, user.id),
    getProjectMemories(id, user.id),
    getProjectArtifacts(id, user.id),
  ])

  return (
    <div className="min-h-screen bg-[#12100e] p-4 text-white md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/projects" className="inline-flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Link>
          <Link href="/chat" className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white">
            Back to chat
          </Link>
        </div>
        <ProjectWorkspaceClient
          project={project}
          conversations={conversations}
          files={files}
          memories={memories}
          artifacts={artifacts}
          initialTab={tab}
        />
      </div>
    </div>
  )
}
