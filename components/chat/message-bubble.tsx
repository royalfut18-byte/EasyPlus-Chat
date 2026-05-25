'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, ThumbsUp, ThumbsDown, RotateCw, FileCode, Sparkles, PanelRightOpen, Sparkles as GeminiIcon, Download, FileText, FileSpreadsheet, FileJson, File as FileIcon, ImageIcon, ScanText, ExternalLink } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { AI_MODELS } from '@/types/models'
import { AnthropicIcon } from '@/components/icons/anthropic-icon'
import { ChatGPTIcon } from '@/components/icons/chatgpt-icon'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { cleanAssistantText } from '@/lib/ai/format-response'
import 'katex/dist/katex.min.css'

import type { ChatAttachment, Artifact } from '@/types/models'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  model?: string
  onRegenerate?: () => void
  attachments?: ChatAttachment[]
  hasArtifact?: boolean
  artifact?: Artifact | null
  onOpenArtifact?: (artifact?: Artifact) => void
  statusLabel?: string | null
  onRequestOcr?: (attachment: ChatAttachment, pageRange: string) => void
}

const ARTIFACT_LOADING_MARKER = '__ARTIFACT_LOADING__'
const ASSISTANT_LOADING_MARKER = '__ASSISTANT_LOADING__'
const LONG_TASK_LOADING_MARKER = '__LONG_TASK_LOADING__'
const RECOVERY_POLLING_MARKER = '__RECOVERY_POLLING__'

// Status config: label → { dotColor, glowColor, iconColor, subtitle }
const STATUS_CONFIG: Record<string, { dotColor: string; glowColor: string; iconColor: string; subtitle: string }> = {
  'Thinking...': { dotColor: 'bg-blue-400', glowColor: 'bg-blue-500/20', iconColor: 'text-blue-400', subtitle: '' },
  'Reading attached files...': { dotColor: 'bg-violet-400', glowColor: 'bg-violet-500/20', iconColor: 'text-violet-400', subtitle: 'Analyzing your files' },
  'Searching the web...': { dotColor: 'bg-emerald-400', glowColor: 'bg-emerald-500/20', iconColor: 'text-emerald-400', subtitle: 'Finding relevant information' },
  'Working through a larger task...': { dotColor: 'bg-amber-400', glowColor: 'bg-amber-500/20', iconColor: 'text-amber-400', subtitle: 'This may take longer than usual' },
  'Reconnecting and recovering response...': { dotColor: 'bg-cyan-400', glowColor: 'bg-cyan-500/20', iconColor: 'text-cyan-400', subtitle: 'The AI is still generating — recovering automatically' },
  'Writing response...': { dotColor: 'bg-blue-400', glowColor: 'bg-blue-500/20', iconColor: 'text-blue-400', subtitle: 'Streaming answer' },
  'Creating artifact...': { dotColor: 'bg-purple-400', glowColor: 'bg-purple-500/20', iconColor: 'text-purple-400', subtitle: 'Preparing preview panel' },
}

function getStatusFromMarker(content: string): string | null {
  if (content === ARTIFACT_LOADING_MARKER) return 'Creating artifact...'
  if (content === ASSISTANT_LOADING_MARKER) return 'Thinking...'
  if (content === LONG_TASK_LOADING_MARKER) return 'Working through a larger task...'
  if (content === RECOVERY_POLLING_MARKER) return 'Reconnecting and recovering response...'
  return null
}

export function MessageBubble({ role, content, model, onRegenerate, attachments, hasArtifact, artifact, onOpenArtifact, statusLabel, onRequestOcr }: MessageBubbleProps) {
  const isUser = role === 'user'
  const [ocrRanges, setOcrRanges] = useState<Record<number, string>>({})
  const modelData = model ? AI_MODELS.find((m) => m.id === model) : null
  const rawContent = content || ''

  // If content is ONLY a marker/empty from DB (no statusLabel and no real text), don't render
  // NEVER hide a message that has real content (>20 chars non-marker)
  const isOnlyMarker = !isUser && !statusLabel && (
    rawContent === ARTIFACT_LOADING_MARKER ||
    rawContent === ASSISTANT_LOADING_MARKER ||
    rawContent === LONG_TASK_LOADING_MARKER ||
    rawContent === RECOVERY_POLLING_MARKER ||
    rawContent.trim() === '...' ||
    rawContent.trim() === ''
  )
  if (isOnlyMarker) return null

  const safeContent = !isUser ? cleanAssistantText(rawContent) : rawContent

  const getAttachmentOpenUrl = (attachment: ChatAttachment): string | null => {
    if (attachment.dataUrl) return attachment.dataUrl
    if (attachment.url) return attachment.url

    const storageKey = attachment.storageKey || attachment.storagePath
    if (attachment.attachmentId) {
      const params = new URLSearchParams({
        attachmentId: attachment.attachmentId,
      })
      return `/api/attachments/file?${params.toString()}`
    }
    if (storageKey) {
      const params = new URLSearchParams({
        key: storageKey,
        name: attachment.name || 'download',
        mimeType: attachment.mimeType || 'application/octet-stream',
      })
      return `/api/attachments/file?${params.toString()}`
    }

    return null
  }

  // Only show status UI if there's an explicit statusLabel (set by live local request).
  const activeStatus = (!isUser && statusLabel) ? statusLabel : null
  const isShowingStatus = !!activeStatus && !isUser

  const hasArtifactCard = !isUser && (hasArtifact || (artifact && artifact.title && artifact.code))

  const copyToClipboard = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(safeContent)
      toast({
        title: 'Copied to clipboard',
        description: 'Message content copied successfully',
      })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('mb-4 md:mb-6', isUser ? 'flex justify-end' : 'flex justify-start')}
    >
      <div
        className={cn(
          'rounded-3xl relative group',
          isUser
            ? 'max-w-[85%] md:max-w-[70%] mb-6 bg-gradient-to-br from-indigo-600/80 to-violet-700/70 backdrop-blur-sm text-white shadow-md shadow-indigo-500/10'
            : 'w-full bg-white/[0.03] border border-white/[0.06] p-3 md:p-4 lg:p-6'
        )}
      >
        {!isUser && modelData && (
          <div className="flex items-center gap-2 mb-2 md:mb-3 pb-2 md:pb-3 border-b border-white/10">
            {modelData.provider === 'anthropic' ? (
              modelData.id === 'claude-haiku-4.5' ? (
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-lg bg-gradient-to-br from-[#10a37f]/20 to-[#10a37f]/10 flex items-center justify-center">
                  <ChatGPTIcon className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#10a37f]" />
                </div>
              ) : (
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-lg bg-gradient-to-br from-[#d97757]/20 to-[#d97757]/10 flex items-center justify-center">
                  <AnthropicIcon className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#d97757]" />
                </div>
              )
            ) : modelData.provider === 'google' ? (
              <div className="w-5 h-5 md:w-6 md:h-6 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/10 flex items-center justify-center">
                <GeminiIcon className="w-3 h-3 md:w-3.5 md:h-3.5 text-blue-400" />
              </div>
            ) : (
              <span className="text-base md:text-lg">{modelData.icon || '🤖'}</span>
            )}
            <span className="text-xs font-medium text-gray-400">{modelData.name}</span>
          </div>
        )}

        {attachments && attachments.length > 0 && (
          <div className={cn(
            'flex flex-wrap gap-2 md:gap-3',
            isUser ? 'px-3 pt-3 pb-2 md:px-4 md:pt-4 md:pb-3' : 'mb-3'
          )}>
            {attachments.map((attachment, index) => {
              const openUrl = getAttachmentOpenUrl(attachment)
              return (
              <div key={index} className="relative group">
                {attachment.type === 'image' && attachment.dataUrl ? (
                  <>
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name || 'Uploaded image'}
                      className={cn(
                        'rounded-xl border object-contain',
                        isUser
                          ? 'max-w-full max-h-[220px] md:max-h-[280px] border-white/20'
                          : 'max-w-full md:max-w-lg max-h-96 border-white/20'
                      )}
                    />
                    {!isUser && (
                      <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70 backdrop-blur-sm"
                          onClick={() => {
                            const link = document.createElement('a')
                            link.href = attachment.dataUrl || ''
                            link.download = attachment.name || 'image.png'
                            document.body.appendChild(link)
                            link.click()
                            document.body.removeChild(link)
                            toast({
                              title: 'Image downloaded',
                              description: 'The image has been saved to your downloads',
                            })
                          }}
                          title="Download image"
                        >
                          <Download className="h-4 w-4 text-white" />
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={cn(
                    'flex flex-col gap-3 px-3.5 py-3 rounded-xl border',
                    isUser
                      ? 'border-white/20 bg-white/10'
                      : 'border-white/10 bg-white/5'
                  )}>
                    <div
                      className={cn(
                        'flex items-center gap-3 min-w-0 rounded-lg',
                        openUrl && 'cursor-pointer hover:bg-white/5'
                      )}
                      role={openUrl ? 'button' : undefined}
                      tabIndex={openUrl ? 0 : undefined}
                      onClick={() => {
                        if (openUrl) window.open(openUrl, '_blank', 'noopener,noreferrer')
                      }}
                      onKeyDown={(event) => {
                        if (openUrl && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault()
                          window.open(openUrl, '_blank', 'noopener,noreferrer')
                        }
                      }}
                    >
                    {attachment.type === 'image' ? (
                      <ImageIcon className="h-5 w-5 text-purple-400 shrink-0" />
                    ) : attachment.mimeType === 'application/pdf' ? (
                      <FileText className="h-5 w-5 text-red-400 shrink-0" />
                    ) : attachment.mimeType === 'text/csv' ? (
                      <FileSpreadsheet className="h-5 w-5 text-green-400 shrink-0" />
                    ) : attachment.mimeType === 'application/json' ? (
                      <FileJson className="h-5 w-5 text-yellow-400 shrink-0" />
                    ) : attachment.mimeType === 'text/markdown' ? (
                      <FileText className="h-5 w-5 text-blue-400 shrink-0" />
                    ) : (
                      <FileIcon className="h-5 w-5 text-gray-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate max-w-[200px]">{attachment.name || (attachment.type === 'image' ? 'Image' : 'Document')}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {attachment.type === 'image' ? 'Image file' :
                         attachment.mimeType === 'application/pdf' ? 'PDF document' :
                         attachment.mimeType === 'text/csv' ? 'CSV file' :
                         attachment.mimeType === 'application/json' ? 'JSON file' :
                         attachment.mimeType === 'text/markdown' ? 'Markdown file' :
                         attachment.mimeType === 'text/plain' ? 'Text file' :
                         'Document attached'}
                        {attachment.size ? ` · ${attachment.size < 1024 * 1024 ? `${(attachment.size / 1024).toFixed(0)} KB` : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`}` : ''}
                        {attachment.storagePath ? ' · Stored' : ''}
                      </p>
                      {(attachment.processingStatus === 'needs_ocr' || attachment.ocrStatus === 'needs_ocr') && (
                        <p className="mt-1 text-[11px] leading-4 text-amber-200">Text extraction failed - scanned PDF detected. OCR needed.</p>
                      )}
                      {attachment.ocrStatus === 'completed' && (
                        <p className="mt-1 text-[11px] leading-4 text-emerald-200">OCR ready</p>
                      )}
                    </div>
                    </div>

                    {openUrl && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs bg-white/10 hover:bg-white/15"
                          onClick={() => window.open(openUrl, '_blank', 'noopener,noreferrer')}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Open file
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs bg-white/10 hover:bg-white/15"
                          onClick={() => {
                            const downloadUrl = openUrl.includes('?') ? `${openUrl}&download=1` : openUrl
                            window.open(downloadUrl, '_blank', 'noopener,noreferrer')
                          }}
                        >
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Download
                        </Button>
                      </div>
                    )}

                    {attachment.mimeType === 'application/pdf' && onRequestOcr && attachment.attachmentId && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs bg-white/10 hover:bg-white/15"
                          onClick={() => onRequestOcr(attachment, '1-5')}
                        >
                          <ScanText className="h-3.5 w-3.5 mr-1.5" />
                          OCR first 5 pages
                        </Button>
                        <input
                          value={ocrRanges[index] || ''}
                          onChange={(event) => setOcrRanges((prev) => ({ ...prev, [index]: event.target.value }))}
                          placeholder="120-125"
                          className="h-7 w-24 rounded-md border border-white/10 bg-black/20 px-2 text-xs text-white placeholder:text-gray-500 outline-none focus:border-violet-400/60"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs bg-white/10 hover:bg-white/15"
                          onClick={() => onRequestOcr(attachment, ocrRanges[index] || '')}
                        >
                          OCR selected pages
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )})}
          </div>
        )}

        <div className={cn(
          'message-content prose prose-invert max-w-none',
          isUser ? 'prose-sm p-3 md:p-4' : 'prose-sm md:prose-base'
        )}>
          {isUser ? (
            safeContent ? <p className="mb-0 whitespace-pre-wrap break-words text-sm md:text-base leading-6">{safeContent}</p> : null
          ) : isShowingStatus ? (
            (() => {
              const config = STATUS_CONFIG[activeStatus!] || STATUS_CONFIG['Thinking...']
              return (
                <div className="flex items-center gap-3 py-2">
                  <div className="relative">
                    <Sparkles className={cn('h-5 w-5 animate-pulse', config.iconColor)} />
                    <div className={cn('absolute inset-0 blur-lg animate-pulse', config.glowColor)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{activeStatus!.replace(/\.\.\.$/, '')}</span>
                      <div className="flex gap-1">
                        <div className={cn('w-1.5 h-1.5 rounded-full animate-bounce', config.dotColor)} style={{ animationDelay: '0ms' }} />
                        <div className={cn('w-1.5 h-1.5 rounded-full animate-bounce', config.dotColor)} style={{ animationDelay: '150ms' }} />
                        <div className={cn('w-1.5 h-1.5 rounded-full animate-bounce', config.dotColor)} style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                    {config.subtitle && (
                      <span className="text-xs text-gray-400">{config.subtitle}</span>
                    )}
                  </div>
                </div>
              )
            })()
          ) : hasArtifactCard && onOpenArtifact ? (
            <div>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  h1: ({ children }) => <h1 className="text-xl md:text-2xl font-bold mt-4 md:mt-6 mb-3 md:mb-4 text-white">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg md:text-xl font-bold mt-4 md:mt-5 mb-2 md:mb-3 text-white">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base md:text-lg font-semibold mt-3 md:mt-4 mb-2 text-white">{children}</h3>,
                  p: ({ children }) => <p className="mb-3 md:mb-4 leading-6 md:leading-7 text-gray-100 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                  table: ({ children }) => (
                    <div className="my-4 overflow-x-auto">
                      <table className="w-full border-collapse border border-white/20 rounded-lg overflow-hidden">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => <thead className="bg-white/10">{children}</thead>,
                  tbody: ({ children }) => <tbody>{children}</tbody>,
                  tr: ({ children }) => <tr className="border-b border-white/10 last:border-0">{children}</tr>,
                  th: ({ children }) => (
                    <th className="px-4 py-2 text-left font-semibold text-white border-r border-white/10 last:border-0">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-4 py-2 text-gray-200 border-r border-white/10 last:border-0">
                      {children}
                    </td>
                  ),
                }}
              >
                {safeContent}
              </ReactMarkdown>
              {artifact && artifact.title && (
                <div className="mt-4 bg-white/[0.03] p-4 rounded-xl border border-violet-500/20 hover:border-violet-500/30 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                        <FileCode className="h-5 w-5 text-violet-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white truncate">{artifact.title}</p>
                        <p className="text-xs text-gray-400 capitalize">{artifact.language} artifact</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => onOpenArtifact(artifact)}
                      size="sm"
                      className="bg-violet-600/80 hover:bg-violet-600 text-white shrink-0"
                    >
                      <PanelRightOpen className="h-4 w-4 mr-2" />
                      Open Artifact
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : safeContent ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
              rehypePlugins={[rehypeKatex]}
              components={{
                h1: ({ children }) => <h1 className="text-xl md:text-2xl font-bold mt-4 md:mt-6 mb-3 md:mb-4 text-white">{children}</h1>,
                h2: ({ children }) => <h2 className="text-lg md:text-xl font-bold mt-4 md:mt-5 mb-2 md:mb-3 text-white">{children}</h2>,
                h3: ({ children }) => <h3 className="text-base md:text-lg font-semibold mt-3 md:mt-4 mb-2 text-white">{children}</h3>,
                h4: ({ children }) => <h4 className="text-sm md:text-base font-semibold mt-3 mb-2 text-gray-200">{children}</h4>,
                p: ({ children }) => <p className="mb-3 md:mb-4 leading-6 md:leading-7 text-gray-100 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 md:mb-4 ml-4 md:ml-6 space-y-1.5 md:space-y-2 list-disc text-gray-100">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 md:mb-4 ml-4 md:ml-6 space-y-1.5 md:space-y-2 list-decimal text-gray-100">{children}</ol>,
                li: ({ children }) => <li className="leading-6 md:leading-7">{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-primary/50 pl-4 py-2 my-4 italic text-gray-300 bg-white/5 rounded-r">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                  >
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="my-4 overflow-x-auto">
                    <table className="w-full border-collapse border border-white/20 rounded-lg overflow-hidden">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-white/10">{children}</thead>,
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => <tr className="border-b border-white/10 last:border-0">{children}</tr>,
                th: ({ children }) => (
                  <th className="px-4 py-2 text-left font-semibold text-white border-r border-white/10 last:border-0">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-2 text-gray-200 border-r border-white/10 last:border-0">
                    {children}
                  </td>
                ),
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  return !inline && match ? (
                    <div className="my-4">
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{
                          margin: 0,
                          borderRadius: '0.5rem',
                          fontSize: '0.875rem',
                          padding: '1rem',
                        }}
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    <code className={cn('text-xs bg-white/20 px-1.5 py-0.5 rounded font-mono text-blue-300', className)} {...props}>
                      {children}
                    </code>
                  )
                },
                strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
                hr: () => <hr className="my-6 border-white/20" />,
              }}
            >
              {safeContent}
            </ReactMarkdown>
          ) : (
            <div className="flex items-center gap-3 py-2">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        <div
          className={cn(
            'flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100',
            isUser ? 'absolute -bottom-6 right-1' : 'mt-2 justify-start'
          )}
        >
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              'h-7 w-7',
              isUser ? 'text-white/90 hover:bg-transparent hover:text-white' : 'hover:bg-white/10'
            )}
            onClick={copyToClipboard}
          >
            <Copy className="h-3 w-3" />
          </Button>
          {!isUser && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 hover:bg-white/10"
                onClick={onRegenerate}
              >
                <RotateCw className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-white/10">
                <ThumbsUp className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-white/10">
                <ThumbsDown className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
