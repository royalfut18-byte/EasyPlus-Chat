import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProjectFiles, getProjectForUser } from '@/lib/projects.server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const project = await getProjectForUser(id, user.id)
    if (!project || project.archived_at) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const files = await getProjectFiles(id, user.id)
    return NextResponse.json({ files })
  } catch (error: any) {
    console.error('[Project Files API] GET failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to list project files' }, { status: 500 })
  }
}
