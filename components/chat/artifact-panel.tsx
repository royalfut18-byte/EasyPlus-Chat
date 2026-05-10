'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Download, Code, Eye, GripVertical } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Artifact } from '@/types/models'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface ArtifactPanelProps {
  artifact: Artifact | null
  isOpen: boolean
  onClose: () => void
  width?: number
  onWidthChange?: (width: number) => void
}

const DEFAULT_WIDTH = 520
const MIN_WIDTH = 380
const MAX_WIDTH_VW = 70

export function ArtifactPanel({ artifact, isOpen, onClose, width = DEFAULT_WIDTH, onWidthChange }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview')
  const [isResizing, setIsResizing] = useState(false)
  const [panelWidth, setPanelWidth] = useState(width)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    setPanelWidth(width)
  }, [width])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return

      const deltaX = resizeRef.current.startX - e.clientX
      const newWidth = Math.max(
        MIN_WIDTH,
        Math.min(
          (window.innerWidth * MAX_WIDTH_VW) / 100,
          resizeRef.current.startWidth + deltaX
        )
      )

      setPanelWidth(newWidth)
      onWidthChange?.(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, onWidthChange])

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeRef.current = {
      startX: e.clientX,
      startWidth: panelWidth,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  if (!artifact || !isOpen) return null

  const canPreview = artifact.language === 'html'
  const isReact = artifact.language === 'tsx' || artifact.language === 'jsx'
  const defaultTab = canPreview ? 'preview' : 'code'
  const currentTab = canPreview || isReact ? activeTab : 'code'

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.code)
    toast({
      title: 'Copied to clipboard',
      description: 'Artifact code copied successfully',
    })
  }

  const handleDownload = () => {
    const extensions: Record<string, string> = {
      html: 'html',
      tsx: 'tsx',
      jsx: 'jsx',
      javascript: 'js',
      css: 'css',
      python: 'py',
      markdown: 'md',
      text: 'txt',
    }

    const extension = extensions[artifact.language] || 'txt'
    const filename = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${extension}`

    const blob = new Blob([artifact.code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: 'Downloaded',
      description: `Artifact saved as ${filename}`,
    })
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed top-0 right-0 h-full glass-strong border-l border-white/10 z-50 flex shadow-2xl"
        style={{
          width: window.innerWidth < 768 ? '100%' : `${panelWidth}px`,
        }}
      >
        {/* Resize Handle - Desktop Only */}
        {window.innerWidth >= 768 && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 hover:w-2 bg-purple-500/0 hover:bg-purple-500/30 cursor-col-resize transition-all group z-10"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical className="h-6 w-6 text-purple-400" />
            </div>
          </div>
        )}

        <div className="flex flex-col flex-1">
          {/* Header */}
          <div className="glass border-b border-white/10 p-4 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-white truncate">{artifact.title}</h3>
              <p className="text-xs text-gray-400 capitalize mt-0.5">
                {artifact.language} • Artifact
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="ml-3 shrink-0 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Tabs */}
          <div className="glass border-b border-white/10 px-4 flex items-center gap-2">
            {canPreview && (
              <button
                onClick={() => setActiveTab('preview')}
                className={cn(
                  'px-4 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2',
                  currentTab === 'preview'
                    ? 'text-white border-purple-500'
                    : 'text-gray-400 border-transparent hover:text-white'
                )}
              >
                <Eye className="h-4 w-4" />
                Preview
              </button>
            )}
            <button
              onClick={() => setActiveTab('code')}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2',
                currentTab === 'code'
                  ? 'text-white border-purple-500'
                  : 'text-gray-400 border-transparent hover:text-white'
              )}
            >
              <Code className="h-4 w-4" />
              Code
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin bg-[#0A0A0F]">
            {currentTab === 'preview' ? (
              canPreview ? (
                <iframe
                  srcDoc={artifact.code}
                  title={artifact.title}
                  sandbox="allow-scripts"
                  className="w-full h-full bg-white border-0"
                />
              ) : isReact ? (
                <div className="flex items-center justify-center h-full p-8 text-center">
                  <div className="max-w-md space-y-4">
                    <div className="text-4xl">⚛️</div>
                    <h4 className="text-lg font-semibold text-white">React Component</h4>
                    <p className="text-sm text-gray-400">
                      Live preview is not available for React components yet. Use the Code tab to view and copy the component code.
                    </p>
                  </div>
                </div>
              ) : null
            ) : (
              <div className="p-4">
                <SyntaxHighlighter
                  language={
                    artifact.language === 'tsx' || artifact.language === 'jsx'
                      ? 'tsx'
                      : artifact.language === 'javascript'
                      ? 'javascript'
                      : artifact.language
                  }
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    background: 'rgba(17, 17, 24, 0.6)',
                  }}
                  showLineNumbers
                  wrapLines
                >
                  {artifact.code}
                </SyntaxHighlighter>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="glass border-t border-white/10 p-4 flex gap-3">
            <Button
              onClick={handleCopy}
              className="flex-1 glass hover:bg-white/10 border border-white/20"
              variant="ghost"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy Code
            </Button>
            <Button
              onClick={handleDownload}
              className="flex-1 gradient-primary hover:opacity-90"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
