'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Download, Code, Eye, GripVertical, Package, AlertTriangle, Blocks, EyeOff, Monitor, Tablet, Smartphone, RefreshCw } from 'lucide-react'
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

const MIN_WIDTH = 380
const MAX_WIDTH_PERCENT = 0.75

export function ArtifactPanel({ artifact, isOpen, onClose, width = 560, onWidthChange }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview')
  const [isResizing, setIsResizing] = useState(false)
  const [currentWidth, setCurrentWidth] = useState(width)
  const [isMobile, setIsMobile] = useState(false)
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    setCurrentWidth(width)
  }, [width])

  useEffect(() => {
    if (!isResizing) return

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault()

      // Calculate new width: distance from pointer to right edge of window
      const newWidth = window.innerWidth - e.clientX

      // Clamp width
      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth))

      setCurrentWidth(clampedWidth)
    }

    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault()
      setIsResizing(false)

      // Restore user select
      document.body.style.userSelect = ''
      document.body.style.cursor = ''

      // Save to localStorage and notify parent
      if (typeof window !== 'undefined') {
        localStorage.setItem('easyplus-artifact-panel-width', currentWidth.toString())
      }
      onWidthChange?.(currentWidth)
    }

    // Add listeners to document for smooth dragging
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)

    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isResizing, currentWidth, onWidthChange])

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    setIsResizing(true)

    // Prevent text selection during resize
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  // Debug logging
  if (process.env.NODE_ENV !== 'production' && isOpen) {
    console.log('[ArtifactPanel] Rendering', {
      hasArtifact: !!artifact,
      title: artifact?.title,
      language: artifact?.language,
      codeLength: artifact?.code?.length,
    })
  }

  const canPreview = artifact?.language === 'html'
  const isReact = artifact?.language === 'tsx' || artifact?.language === 'jsx'
  const currentTab = canPreview || isReact ? activeTab : 'code'

  const renderPanelContent = () => (
    <div className="flex flex-col h-full" style={{ paddingLeft: isMobile ? 0 : '12px' }}>
      {/* Dev Debug Info */}
      {process.env.NODE_ENV !== 'production' && (
        <div className="bg-yellow-500/20 border-b border-yellow-500/50 p-2 text-xs text-yellow-300">
          Debug: Artifact loaded: {artifact ? 'YES' : 'NO'} | Language: {artifact?.language || 'N/A'} | Code length: {artifact?.code?.length || 0}
        </div>
      )}

      {/* Header */}
      <div className="glass border-b border-white/10 p-4 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-white truncate">
            {artifact?.title || 'No Artifact'}
          </h3>
          <p className="text-xs text-gray-400 capitalize mt-0.5">
            {artifact?.language ? `${artifact.language} • Artifact` : 'No artifact selected'}
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

      {/* Tabs and Controls */}
      <div className="glass border-b border-white/10 px-4 flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
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

        {/* Device Preview Controls - Only show in preview tab for HTML */}
        {canPreview && currentTab === 'preview' && artifact?.code && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPreviewDevice('desktop')}
              title="Desktop view"
              className={cn(
                'p-2 rounded transition-colors',
                previewDevice === 'desktop'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Monitor className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPreviewDevice('tablet')}
              title="Tablet view"
              className={cn(
                'p-2 rounded transition-colors',
                previewDevice === 'tablet'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Tablet className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPreviewDevice('mobile')}
              title="Mobile view"
              className={cn(
                'p-2 rounded transition-colors',
                previewDevice === 'mobile'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Smartphone className="h-4 w-4" />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              title="Refresh preview"
              className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#0A0A0F]">
        {!artifact ? (
          <div className="flex items-center justify-center h-full p-8 text-center">
            <div className="max-w-md space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-gray-400 mx-auto">
                <Package className="h-8 w-8" />
              </div>
              <h4 className="text-lg font-semibold text-white">No Artifact Selected</h4>
              <p className="text-sm text-gray-400">
                Create or select an artifact to view it here.
              </p>
            </div>
          </div>
        ) : !artifact.code ? (
          <div className="flex items-center justify-center h-full p-8 text-center">
            <div className="max-w-md space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-500/30 bg-orange-500/10 text-orange-400 mx-auto">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <h4 className="text-lg font-semibold text-white">Empty Artifact</h4>
              <p className="text-sm text-gray-400">
                This artifact has no code to display.
              </p>
            </div>
          </div>
        ) : currentTab === 'preview' ? (
          canPreview ? (
            <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col items-center justify-center p-4">
              {/* Interactive hint for games/apps */}
              <div className="text-center mb-2">
                <p className="text-xs text-gray-400">
                  Click inside preview to interact • Press keys for controls
                </p>
              </div>
              <div
                className="bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-200 transition-all duration-300 cursor-pointer"
                style={{
                  width: previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%',
                  maxWidth: '100%',
                  height: previewDevice === 'desktop' ? 'calc(100% - 28px)' : 'auto',
                  maxHeight: previewDevice === 'desktop' ? '100%' : 'calc(100% - 28px)',
                }}
                onClick={() => iframeRef.current?.focus()}
              >
                <iframe
                  ref={iframeRef}
                  key={refreshKey}
                  srcDoc={artifact.code}
                  title={artifact.title}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
                  className="w-full h-full border-0 bg-white pointer-events-auto"
                  style={{
                    minHeight: previewDevice !== 'desktop' ? '600px' : undefined,
                  }}
                  tabIndex={0}
                  onLoad={() => {
                    // Auto-focus iframe after load for keyboard controls
                    setTimeout(() => iframeRef.current?.focus(), 100)
                  }}
                />
              </div>
            </div>
          ) : isReact ? (
            <div className="flex items-center justify-center h-full p-8 text-center">
              <div className="max-w-md space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mx-auto">
                  <Blocks className="h-8 w-8" />
                </div>
                <h4 className="text-lg font-semibold text-white">React Component</h4>
                <p className="text-sm text-gray-400">
                  Live preview is not available for React components yet. Use the Code tab to view and copy the component code.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full p-8 text-center">
              <div className="max-w-md space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-gray-400 mx-auto">
                  <EyeOff className="h-8 w-8" />
                </div>
                <h4 className="text-lg font-semibold text-white">Preview Not Available</h4>
                <p className="text-sm text-gray-400">
                  Preview is only available for HTML artifacts. Switch to the Code tab to view the {artifact.language} code.
                </p>
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 overflow-auto p-4 min-h-0">
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
      {artifact && artifact.code && (
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
      )}
    </div>
  )

  const handleCopy = () => {
    if (!artifact?.code) return
    navigator.clipboard.writeText(artifact.code)
    toast({
      title: 'Copied to clipboard',
      description: 'Artifact code copied successfully',
    })
  }

  const handleDownload = () => {
    if (!artifact?.code) return

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
    <>
      {/* Mobile: Fixed overlay full-screen */}
      {isMobile && isOpen && (
        <AnimatePresence>
          <motion.div
            ref={panelRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-0 z-50 bg-[#0A0A0F] md:hidden"
          >
            {renderPanelContent()}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Desktop: Flex child */}
      {!isMobile && isOpen && (
        <aside
          ref={panelRef}
          className="hidden md:flex relative h-full min-h-0 flex-shrink-0 flex-col border-l border-white/10 bg-[#07070d] shadow-2xl"
          style={{ width: `${currentWidth}px` }}
        >
          {/* Resize Handle - Desktop Only - Full Height */}
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group',
              'hover:bg-purple-500/10 transition-colors',
              isResizing && 'bg-purple-500/20'
            )}
            style={{
              zIndex: 100,
              pointerEvents: 'auto',
            }}
            onPointerDown={handleResizeStart}
          >
            {/* Vertical line spanning full height */}
            <div className={cn(
              'absolute left-1 w-px h-full bg-purple-500/40 transition-colors',
              'group-hover:bg-purple-400/60',
              isResizing && 'bg-purple-400'
            )} />
            {/* Centered grip indicator */}
            <div className={cn(
              'absolute top-1/2 left-0.5 -translate-y-1/2 w-1.5 h-16 rounded-full bg-purple-400/60 transition-opacity',
              'opacity-0 group-hover:opacity-100',
              isResizing && 'opacity-100'
            )} />
          </div>

          {renderPanelContent()}
        </aside>
      )}
    </>
  )
}
