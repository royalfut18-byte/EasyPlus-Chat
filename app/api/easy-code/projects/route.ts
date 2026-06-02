import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createEasyCodeProjectShell, listEasyCodeProjects, requireEasyCodeUser, sanitizeEasyCodePrompt } from '@/lib/easy-code.server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const projects = await listEasyCodeProjects(user.id)
    return NextResponse.json({ projects }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error: any) {
    console.error('[Easy Code] Project list failed', { message: error?.message })
    return NextResponse.json({ error: 'Could not load Easy Code projects.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = await requireEasyCodeUser(user.id)
    if (entitlementBlock) return entitlementBlock

    const body = await request.json().catch(() => null)
    const prompt = sanitizeEasyCodePrompt(body?.prompt)
    if (prompt.length < 5) return NextResponse.json({ error: 'Describe what you want to build.' }, { status: 400 })
    const clientRequestId = typeof body?.clientRequestId === 'string' ? body.clientRequestId.trim().slice(0, 100) : ''
    if (!clientRequestId) return NextResponse.json({ error: 'Could not create project. Please try again.' }, { status: 400 })

    const result = await createEasyCodeProjectShell(user.id, prompt, clientRequestId)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error: any) {
    console.error('[Easy Code] Project create failed', {
      message: error?.message,
      phase: 'create_project',
    })
    return NextResponse.json({ error: error?.message || 'Could not create project. Please try again.' }, { status: 500 })
  }
}
