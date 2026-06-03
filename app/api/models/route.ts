import { NextResponse } from 'next/server'
import { getAvailablePublicModelIds, getPublicModelCapabilities } from '@/lib/ai/model-routing.server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET() {
  return NextResponse.json(
    {
      availableModelIds: await getAvailablePublicModelIds(),
      capabilities: getPublicModelCapabilities(),
    },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
  )
}
