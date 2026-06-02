import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/admin-access.server'
import { getAzureDeepSeekDiagnostics } from '@/lib/ai/azure-deepseek.server'
import { getAzureImageDiagnostics } from '@/lib/ai/azure-image.server'
import { getR2ConfigStatus } from '@/lib/storage/r2'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await getAdminAccess(user.id))?.isMainAdmin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [deepseek, imageGeneration] = await Promise.all([
    getAzureDeepSeekDiagnostics(true),
    getAzureImageDiagnostics(true),
  ])
  const r2 = getR2ConfigStatus()

  return NextResponse.json({
    azureDeepseek: deepseek,
    azureImageGeneration: {
      ...imageGeneration,
      r2Configured: r2.configured,
      missingStorageEnv: r2.missing,
    },
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
