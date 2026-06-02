import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEasyCodeProject, requireEasyCodeUser, runEasyCodeInitialGeneration } from '@/lib/easy-code.server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = await requireEasyCodeUser(user.id)
    if (entitlementBlock) return entitlementBlock

    const project = await getEasyCodeProject(user.id, id)
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

    const result = await runEasyCodeInitialGeneration(user.id, id)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error: any) {
    const timeoutHit = /aborted|timeout|timed out/i.test(error?.message || '') || error?.name === 'AbortError' || error?.name === 'TimeoutError'
    console.error('[Easy Code] Generate route failed', {
      message: error?.message,
      phase: 'generate_project',
      timeoutHit,
    })
    return NextResponse.json(
      { error: error?.message || 'Project was created but generation failed.' },
      { status: timeoutHit ? 504 : 500 }
    )
  }
}
