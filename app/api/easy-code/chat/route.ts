import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireEasyCodeUser, runEasyCodeEdit, sanitizeEasyCodePrompt } from '@/lib/easy-code.server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const entitlementBlock = await requireEasyCodeUser(user.id)
    if (entitlementBlock) return entitlementBlock

    const body = await request.json().catch(() => null)
    const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
    const instruction = sanitizeEasyCodePrompt(body?.message)
    const selectedPath = typeof body?.selectedPath === 'string' ? body.selectedPath : null
    if (!projectId) return NextResponse.json({ error: 'Project is required.' }, { status: 400 })
    if (instruction.length < 3) return NextResponse.json({ error: 'Describe the change you want.' }, { status: 400 })

    const result = await runEasyCodeEdit(user.id, projectId, instruction, selectedPath)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error: any) {
    console.error('[Easy Code] Chat edit failed', {
      message: error?.message,
      phase: 'easy_code_chat',
    })
    const message = typeof error?.message === 'string' && (
      error.message === 'The AI returned invalid file data. Try again.' ||
      error.message === 'Could not generate files. Please try again in a moment.' ||
      error.message === 'Could not generate files.' ||
      error.message === 'This Easy Code project has reached the file limit.'
    ) ? error.message : 'Could not generate files.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
