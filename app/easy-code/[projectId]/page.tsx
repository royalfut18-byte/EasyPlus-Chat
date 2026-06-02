import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEasyCodeFiles, getEasyCodeMessages, getEasyCodeProject } from '@/lib/easy-code.server'
import { EasyCodeWorkspaceClient } from './easy-code-workspace-client'

export default async function EasyCodeProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [project, files, messages] = await Promise.all([
    getEasyCodeProject(user.id, projectId),
    getEasyCodeFiles(user.id, projectId).catch(() => []),
    getEasyCodeMessages(user.id, projectId).catch(() => []),
  ])
  if (!project) redirect('/easy-code')

  return <EasyCodeWorkspaceClient initialProject={project} initialFiles={files} initialMessages={messages} />
}
