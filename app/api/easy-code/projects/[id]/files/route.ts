import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { bytesOf, EASY_CODE_MAX_PROJECT_FILES, getEasyCodeFiles, getEasyCodeProject, inferLanguage, requireEasyCodeUser, validateEasyCodePath } from '@/lib/easy-code.server'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const project = await getEasyCodeProject(user.id, id)
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    const files = await getEasyCodeFiles(user.id, id)
    return NextResponse.json({ files }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error: any) {
    console.error('[Easy Code] File list failed', { message: error?.message })
    return NextResponse.json({ error: 'Could not load files.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const entitlementBlock = await requireEasyCodeUser(user.id)
    if (entitlementBlock) return entitlementBlock
    const project = await getEasyCodeProject(user.id, id)
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const path = validateEasyCodePath(body?.path)
    const content = typeof body?.content === 'string' ? body.content : ''
    const existingFiles = await getEasyCodeFiles(user.id, id)
    const alreadyExists = existingFiles.some((file) => file.path.toLowerCase() === path.toLowerCase())
    if (!alreadyExists && existingFiles.length >= EASY_CODE_MAX_PROJECT_FILES) {
      return NextResponse.json({ error: 'This Easy Code project has reached the file limit.' }, { status: 400 })
    }
    if (bytesOf(content) > 220_000) return NextResponse.json({ error: 'File is too large.' }, { status: 400 })
    const language = typeof body?.language === 'string' ? body.language.slice(0, 40) : inferLanguage(path)

    const db = await createServiceClient() as any
    const { data, error } = await db.from('easy_code_files').upsert({
      project_id: id,
      user_id: user.id,
      path,
      language,
      content,
      size_bytes: bytesOf(content),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,path' }).select('*').single()
    if (error) throw error
    await db.from('easy_code_projects').update({ updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
    return NextResponse.json({ file: data })
  } catch (error: any) {
    console.error('[Easy Code] File save failed', { message: error?.message })
    return NextResponse.json({ error: error?.message || 'File could not be saved.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const entitlementBlock = await requireEasyCodeUser(user.id)
    if (entitlementBlock) return entitlementBlock
    const project = await getEasyCodeProject(user.id, id)
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

    const path = validateEasyCodePath(request.nextUrl.searchParams.get('path'))
    const db = await createServiceClient() as any
    const { error } = await db.from('easy_code_files').delete().eq('project_id', id).eq('user_id', user.id).eq('path', path)
    if (error) throw error
    await db.from('easy_code_projects').update({ updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Easy Code] File delete failed', { message: error?.message })
    return NextResponse.json({ error: 'File could not be deleted.' }, { status: 500 })
  }
}
