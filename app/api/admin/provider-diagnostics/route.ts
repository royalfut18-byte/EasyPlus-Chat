import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/admin-access.server'
import { getDeepSeekV4ProDiagnostics } from '@/lib/ai/nvidia.server'
import { getNvidiaImageDiagnostics } from '@/lib/ai/nvidia-image.server'
import { getR2ConfigStatus } from '@/lib/storage/r2'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await getAdminAccess(user.id))?.isMainAdmin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [deepseek, imageGeneration] = await Promise.all([
    getDeepSeekV4ProDiagnostics(true),
    getNvidiaImageDiagnostics(true),
  ])
  const r2 = getR2ConfigStatus()

  return NextResponse.json({
    deepseek,
    imageGeneration: {
      ...imageGeneration,
      r2Configured: r2.configured,
      missingStorageEnv: r2.missing,
    },
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
