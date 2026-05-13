'use client'

import { motion } from 'framer-motion'
import { Copy, ThumbsUp, ThumbsDown, RotateCw, FileCode, Sparkles, PanelRightOpen, Sparkles as GeminiIcon, Download } from 'lucide-react'
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
}

const ARTIFACT_LOADING_MARKER = '__ARTIFACT_LOADING__'
const ASSISTANT_LOADING_MARKER = '__ASSISTANT_LOADING__'

export function MessageBubble({ role, content, model, onRegenerate, attachments, hasArtifact, artifact, onOpenArtifact }: MessageBubbleProps) {
  const isUser = role === 'user'
  const modelData = model ? AI_MODELS.find((m) => m.id === model) : null
  const rawContent = content || ''
  const safeContent = !isUser ? cleanAssistantText(rawContent) : rawContent

  // Check for loading markers
  const isArtifactLoading = !isUser && safeContent === ARTIFACT_LOADING_MARKER
  const isAssistantLoading = !isUser && safeContent === ASSISTANT_LOADING_MARKER

  // Check if this is a stuck/old loading marker (shouldn't persist in database)
  const isStuckLoadingMarker = !isUser && (safeContent === ARTIFACT_LOADING_MARKER || safeContent === ASSISTANT_LOADING_MARKER)

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
          'rounded-[22px] relative group',
          isUser
            ? 'max-w-[88%] md:max-w-[70%] bg-gradient-to-br from-purple-600/90 to-blue-600/90 backdrop-blur-sm text-white shadow-lg'
            : 'w-full glass p-3 md:p-4 lg:p-6'
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
            isUser ? 'mb-3 p-3 md:p-4' : 'mb-3'
          )}>
            {attachments.map((attachment, index) => (
              <div key={index} className="relative group">
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
              </div>
            ))}
          </div>
        )}

        <div className={cn(
          'message-content prose prose-invert max-w-none',
          isUser ? 'prose-sm p-3 md:p-4' : 'prose-sm md:prose-base'
        )}>
          {isUser ? (
            safeContent ? <p className="mb-0 whitespace-pre-wrap break-words text-sm md:text-base leading-6">{safeContent}</p> : null
          ) : isArtifactLoading ? (
            <div className="flex items-center gap-3 py-2">
              <div className="relative">
                <FileCode className="h-6 w-6 text-purple-400 animate-pulse" />
                <div className="absolute inset-0 bg-purple-500/20 blur-lg animate-pulse" />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">Creating artifact</span>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
                <span className="text-xs text-gray-400">Preparing preview panel...</span>
              </div>
            </div>
          ) : isAssistantLoading ? (
            <div className="flex items-center gap-3 py-2">
              <div className="relative">
                <Sparkles className="h-5 w-5 text-blue-400 animate-pulse" />
                <div className="absolute inset-0 bg-blue-500/20 blur-lg animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">Thinking</span>
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          ) : hasArtifactCard && onOpenArtifact ? (
            <div>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  h1: ({ children }) => <h1 className="text-xl md:text-2xl font-bold mt-4 md:mt-6 mb-3 md:mb-4 text-white">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg md:text-xl font-bold mt-4 md:mt-5 mb-2 md:mb-3 text-white">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base md:text-lg font-semibold mt-3 md:mt-4 mb-2 text-white">{children}</h3>,
                  p: ({ children }) => <p className="mb-3 md:mb-4 leading-6 md:leading-7 text-gray-100 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                }}
              >
                {safeContent}
              </ReactMarkdown>
              {artifact && artifact.title && (
                <div className="mt-4 glass-strong p-4 rounded-xl border border-purple-500/30 hover:border-purple-500/50 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-purple-500/10 flex items-center justify-center shrink-0">
                        <FileCode className="h-5 w-5 text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white truncate">{artifact.title}</p>
                        <p className="text-xs text-gray-400 capitalize">{artifact.language} artifact</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => onOpenArtifact(artifact)}
                      size="sm"
                      className="gradient-primary shrink-0"
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
              remarkPlugins={[remarkGfm, remarkMath]}
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
            'absolute bottom-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity',
            isUser ? 'right-2' : 'left-2'
          )}
        >
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover:bg-white/10"
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
