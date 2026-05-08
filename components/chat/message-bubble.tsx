'use client'

import { motion } from 'framer-motion'
import { Copy, ThumbsUp, ThumbsDown, RotateCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { AI_MODELS } from '@/types/models'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import 'katex/dist/katex.min.css'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  model?: string
  onRegenerate?: () => void
}

export function MessageBubble({ role, content, model, onRegenerate }: MessageBubbleProps) {
  const isUser = role === 'user'
  const modelData = model ? AI_MODELS.find((m) => m.id === model) : null

  const copyToClipboard = () => {
    navigator.clipboard.writeText(content)
    toast({
      title: 'Copied to clipboard',
      description: 'Message content copied successfully',
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('flex gap-4 mb-6', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[80%] rounded-2xl p-4 relative group',
          isUser
            ? 'gradient-primary text-white ml-auto'
            : 'glass text-gray-100'
        )}
      >
        {!isUser && modelData && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
            <span className="text-lg">{modelData.icon}</span>
            <span className="text-xs font-medium text-gray-400">{modelData.name}</span>
          </div>
        )}

        <div className="message-content prose prose-invert max-w-none">
          {isUser ? (
            <p className="mb-0">{content}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        margin: 0,
                        borderRadius: '0.5rem',
                        fontSize: '0.875rem',
                      }}
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={cn('text-xs bg-white/10 px-1.5 py-0.5 rounded', className)} {...props}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {content}
            </ReactMarkdown>
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
