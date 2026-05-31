import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement } from '@/lib/account-entitlements.server'
import { getProjectsWithStatsForUser } from '@/lib/projects.server'
import { ProjectsClient } from './projects-client'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = await createServiceClient() as any
  const entitlement = await getAccountEntitlement(db, user.id)
  if (!entitlement) redirect('/login')

  const projects = await getProjectsWithStatsForUser(user.id)

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-4 text-white md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Link href="/chat" className="inline-flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Back to chat
        </Link>
        {entitlement.status !== 'active' && (
          <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5 text-amber-100">
            Your subscription has ended. You can view existing projects, but creating or editing projects is blocked server-side.
          </section>
        )}
        <ProjectsClient initialProjects={projects} />
      </div>
    </div>
  )
}
