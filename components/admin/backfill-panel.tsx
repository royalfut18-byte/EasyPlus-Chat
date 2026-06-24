'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Brain, Play, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

interface BackfillStats {
  totalConversations: number
  processedConversations: number
  unprocessed: number
  totalMemories: number
  totalChunks: number
  totalAttachments: number
}

interface BackfillResult {
  success: boolean
  progress: {
    totalConversations: number
    processed: number
    skipped: number
    errors: number
    memoriesCreated: number
    chunksCreated: number
    attachmentsProcessed: number
    summariesGenerated: number
    logs: string[]
  }
}

export function BackfillPanel() {
  const [stats, setStats] = useState<BackfillStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState('')
  const [targetConvId, setTargetConvId] = useState('')
  const [limit, setLimit] = useState('50')
  const [dryRun, setDryRun] = useState(true)
  const [force, setForce] = useState(false)

  const loadStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/backfill-memory')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setStats(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const runBackfill = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/backfill-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetUserId || undefined,
          conversationId: targetConvId || undefined,
          dryRun,
          force,
          limit: parseInt(limit) || 50,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card className="bg-white/[0.02] border-white/[0.06]">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-clay-400" />
          Memory Backfill
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={loadStats}
          disabled={loading}
          className="border-white/10 text-gray-300 hover:text-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load Stats'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-xs text-gray-500">Total Chats</p>
              <p className="text-lg font-semibold text-white">{stats.totalConversations}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-xs text-gray-500">Processed</p>
              <p className="text-lg font-semibold text-green-400">{stats.processedConversations}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-xs text-gray-500">Unprocessed</p>
              <p className="text-lg font-semibold text-amber-400">{stats.unprocessed}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-xs text-gray-500">Memories</p>
              <p className="text-lg font-semibold text-white">{stats.totalMemories}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-xs text-gray-500">Chunks</p>
              <p className="text-lg font-semibold text-white">{stats.totalChunks}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <p className="text-xs text-gray-500">Attachments</p>
              <p className="text-lg font-semibold text-white">{stats.totalAttachments}</p>
            </div>
          </div>
        )}

        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">User ID (empty = all users)</label>
              <input
                type="text"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                placeholder="UUID or empty"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-clay-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Conversation ID (empty = all)</label>
              <input
                type="text"
                value={targetConvId}
                onChange={(e) => setTargetConvId(e.target.value)}
                placeholder="UUID or empty"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-clay-500/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Limit</label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="w-20 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-clay-500/50"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer mt-4">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded border-white/20"
              />
              <span className="text-sm text-gray-300">Dry Run</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer mt-4">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="rounded border-white/20"
              />
              <span className="text-sm text-gray-300">Force Re-process</span>
            </label>
          </div>

          <Button
            onClick={runBackfill}
            disabled={running}
            className="bg-clay-600 hover:bg-clay-500 text-white"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                {dryRun ? 'Preview Backfill' : 'Run Backfill'}
              </>
            )}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <span className="text-sm text-green-300 font-medium">Backfill Complete</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Processed</p>
                <p className="text-sm font-medium text-white">{result.progress.processed}</p>
              </div>
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Skipped</p>
                <p className="text-sm font-medium text-white">{result.progress.skipped}</p>
              </div>
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Errors</p>
                <p className="text-sm font-medium text-red-400">{result.progress.errors}</p>
              </div>
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Memories</p>
                <p className="text-sm font-medium text-white">{result.progress.memoriesCreated}</p>
              </div>
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Chunks</p>
                <p className="text-sm font-medium text-white">{result.progress.chunksCreated}</p>
              </div>
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Attachments</p>
                <p className="text-sm font-medium text-white">{result.progress.attachmentsProcessed}</p>
              </div>
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Summaries</p>
                <p className="text-sm font-medium text-white">{result.progress.summariesGenerated}</p>
              </div>
              <div className="p-2 rounded bg-white/[0.03]">
                <p className="text-[10px] text-gray-500">Total</p>
                <p className="text-sm font-medium text-white">{result.progress.totalConversations}</p>
              </div>
            </div>

            {result.progress.logs.length > 0 && (
              <details className="group">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                  Show logs ({result.progress.logs.length} entries)
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-black/30 p-3 text-[11px] font-mono text-gray-400 space-y-0.5">
                  {result.progress.logs.map((log, i) => (
                    <div key={i} className={log.includes('Error') || log.includes('error') ? 'text-red-400' : ''}>
                      {log}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
