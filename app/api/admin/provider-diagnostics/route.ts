import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/admin-access.server'
import { getAzureDeepSeekDiagnostics } from '@/lib/ai/azure-deepseek.server'
import { getEasyCodeProviderDiagnosticsSummary } from '@/lib/ai/easy-code-provider-diagnostics.server'
import { getAzureGpt54Diagnostics } from '@/lib/ai/azure-gpt54.server'
import { getAzureImageDiagnostics } from '@/lib/ai/azure-image.server'
import { getPublicChatRoutingDiagnostics } from '@/lib/ai/model-routing.server'
import { getR2ConfigStatus } from '@/lib/storage/r2'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await getAdminAccess(user.id))?.isMainAdmin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [gpt54, deepseek, imageGeneration, chatTextRouting] = await Promise.all([
    getAzureGpt54Diagnostics(true),
    getAzureDeepSeekDiagnostics(true),
    getAzureImageDiagnostics(true),
    getPublicChatRoutingDiagnostics(),
  ])
  const r2 = getR2ConfigStatus()
  const easyCodeProvider = getEasyCodeProviderDiagnosticsSummary()

  return NextResponse.json({
    chatTextRouting,
    azureGpt54: gpt54,
    azureDeepseek: deepseek,
    ...easyCodeProvider,
    azureImageGeneration: {
      ...imageGeneration,
      r2Configured: r2.configured,
      missingStorageEnv: r2.missing,
    },
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
