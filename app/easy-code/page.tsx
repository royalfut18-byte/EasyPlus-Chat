import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listEasyCodeProjects } from '@/lib/easy-code.server'
import { EasyCodeHomeClient } from './easy-code-home-client'

export default async function EasyCodePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const projects = await listEasyCodeProjects(user.id).catch(() => [])
  return <EasyCodeHomeClient initialProjects={projects} />
}
