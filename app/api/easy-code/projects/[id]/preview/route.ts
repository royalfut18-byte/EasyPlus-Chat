import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildStaticPreviewHtml, getEasyCodeFiles, getEasyCodeProject } from '@/lib/easy-code.server'

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
    const previewEligible = project.framework === 'html' || (
      files.some((file) => file.path.toLowerCase() === 'index.html') &&
      files.some((file) => file.path.toLowerCase() === 'styles.css') &&
      files.some((file) => file.path.toLowerCase() === 'script.js')
    )
    if (!previewEligible) {
      return NextResponse.json({ previewType: 'unsupported', message: 'Preview is unavailable for this project type.' })
    }
    const html = buildStaticPreviewHtml(files)
    if (!html) {
      return NextResponse.json({ previewType: 'unsupported', message: 'Preview is unavailable for this project type.' })
    }
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error: any) {
    console.error('[Easy Code] Preview failed', { message: error?.message })
    return NextResponse.json({ error: 'Preview is unavailable for this project type.' }, { status: 500 })
  }
}
