import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/admin-access.server'
import { getAzureDeepSeekDiagnostics } from '@/lib/ai/azure-deepseek.server'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await getAdminAccess(user.id))?.isMainAdmin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const deepseek = await getAzureDeepSeekDiagnostics(true)

  return NextResponse.json({
    deepseek,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
