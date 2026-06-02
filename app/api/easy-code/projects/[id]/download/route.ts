import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildEasyCodeZip, getEasyCodeFiles, getEasyCodeProject, slugFileName } from '@/lib/easy-code.server'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const project = await getEasyCodeProject(user.id, id)
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    const files = await getEasyCodeFiles(user.id, id)
    const zip = await buildEasyCodeZip(project, files)
    const filename = `${slugFileName(project.title)}.zip`
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error: any) {
    console.error('[Easy Code] ZIP download failed', { message: error?.message })
    return NextResponse.json({ error: error?.message || 'Download failed.' }, { status: 500 })
  }
}
