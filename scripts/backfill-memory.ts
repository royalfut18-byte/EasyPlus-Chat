/**
 * Backfill Memory Script
 *
 * Processes existing conversations to generate summaries, memories, and chunks.
 *
 * Usage:
 *   npx tsx scripts/backfill-memory.ts [options]
 *
 * Options:
 *   --user-id=<uuid>          Process only this user
 *   --conversation-id=<uuid>  Process only this conversation
 *   --dry-run                 Preview without writing
 *   --force                   Re-process already processed conversations
 *   --limit=<n>               Max conversations to process
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL  Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key (required)
 */

import { createClient } from '@supabase/supabase-js'
import { runBackfill } from '../lib/ai/backfill-memory'

async function main() {
  const args = process.argv.slice(2)

  const getArg = (name: string): string | undefined => {
    const arg = args.find(a => a.startsWith(`--${name}=`))
    return arg ? arg.split('=')[1] : undefined
  }

  const hasFlag = (name: string): boolean => args.includes(`--${name}`)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const options = {
    userId: getArg('user-id'),
    conversationId: getArg('conversation-id'),
    dryRun: hasFlag('dry-run'),
    force: hasFlag('force'),
    limit: getArg('limit') ? parseInt(getArg('limit')!, 10) : undefined,
  }

  console.log('Starting backfill with options:', options)
  console.log('---')

  const progress = await runBackfill(db as any, options)

  console.log('\n--- RESULTS ---')
  console.log(`Total conversations: ${progress.totalConversations}`)
  console.log(`Processed: ${progress.processed}`)
  console.log(`Skipped: ${progress.skipped}`)
  console.log(`Errors: ${progress.errors}`)
  console.log(`Memories created: ${progress.memoriesCreated}`)
  console.log(`Chunks created: ${progress.chunksCreated}`)
  console.log(`Attachments processed: ${progress.attachmentsProcessed}`)
  console.log(`Summaries generated: ${progress.summariesGenerated}`)

  if (progress.errors > 0) {
    console.log('\n--- ERRORS ---')
    for (const log of progress.logs.filter(l => l.includes('Error') || l.includes('error'))) {
      console.log(log)
    }
  }

  process.exit(progress.errors > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
