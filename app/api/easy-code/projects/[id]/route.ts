import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getEasyCodeFiles, getEasyCodeMessages, getEasyCodeProject, requireEasyCodeUser } from '@/lib/easy-code.server'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [project, files, messages] = await Promise.all([
      getEasyCodeProject(user.id, id),
      getEasyCodeFiles(user.id, id),
      getEasyCodeMessages(user.id, id),
    ])
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

    return NextResponse.json({ project, files, messages }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error: any) {
    console.error('[Easy Code] Project load failed', { message: error?.message })
    return NextResponse.json({ error: 'Could not load project.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = await requireEasyCodeUser(user.id)
    if (entitlementBlock) return entitlementBlock

    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 80) : null
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 1000) : undefined
    if (!title && description === undefined) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

    const db = await createServiceClient() as any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (title) updates.title = title
    if (description !== undefined) updates.description = description || null

    const { data, error } = await db
      .from('easy_code_projects')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ project: data })
  } catch (error: any) {
    console.error('[Easy Code] Project update failed', { message: error?.message })
    return NextResponse.json({ error: 'Could not update project.' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = await requireEasyCodeUser(user.id)
    if (entitlementBlock) return entitlementBlock

    const db = await createServiceClient() as any
    const { error } = await db
      .from('easy_code_projects')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Easy Code] Project archive failed', { message: error?.message })
    return NextResponse.json({ error: 'Could not delete project.' }, { status: 500 })
  }
}
