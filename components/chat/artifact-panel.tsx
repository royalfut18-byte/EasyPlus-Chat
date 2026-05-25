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
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function createCrc32Table(): number[] {
  const table: number[] = []
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let j = 0; j < 8; j++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
}

const CRC32_TABLE = createCrc32Table()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff)
}

function writeUint32(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function pushBytes(output: number[], bytes: Uint8Array) {
  for (const byte of bytes) {
    output.push(byte)
  }
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function createZip(files: Array<{ name: string; content: string }>): Blob {
  const output: number[] = []
  const centralDirectory: number[] = []

  for (const file of files) {
    const nameBytes = encodeText(file.name)
    const contentBytes = encodeText(file.content)
    const checksum = crc32(contentBytes)
    const localHeaderOffset = output.length

    writeUint32(output, 0x04034b50)
    writeUint16(output, 20)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint32(output, checksum)
    writeUint32(output, contentBytes.length)
    writeUint32(output, contentBytes.length)
    writeUint16(output, nameBytes.length)
    writeUint16(output, 0)
    pushBytes(output, nameBytes)
    pushBytes(output, contentBytes)

    writeUint32(centralDirectory, 0x02014b50)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, checksum)
    writeUint32(centralDirectory, contentBytes.length)
    writeUint32(centralDirectory, contentBytes.length)
    writeUint16(centralDirectory, nameBytes.length)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, 0)
    writeUint32(centralDirectory, localHeaderOffset)
    pushBytes(centralDirectory, nameBytes)
  }

  const centralDirectoryOffset = output.length
  output.push(...centralDirectory)

  writeUint32(output, 0x06054b50)
  writeUint16(output, 0)
  writeUint16(output, 0)
  writeUint16(output, files.length)
  writeUint16(output, files.length)
  writeUint32(output, centralDirectory.length)
  writeUint32(output, centralDirectoryOffset)
  writeUint16(output, 0)

  return new Blob([new Uint8Array(output)], { type: DOCX_MIME_TYPE })
}

function paragraphXml(line: string): string {
  const trimmed = line.trim()
  const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
  const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
  const text = headingMatch?.[2] || bulletMatch?.[1] || trimmed
  const bold = headingMatch ? '<w:b/>' : ''
  const size = headingMatch
    ? headingMatch[1].length === 1 ? '<w:sz w:val="32"/>' : '<w:sz w:val="28"/>'
    : ''
  const prefix = bulletMatch ? '- ' : ''

  return `<w:p><w:r><w:rPr>${bold}${size}</w:rPr><w:t xml:space="preserve">${escapeXml(prefix + text)}</w:t></w:r></w:p>`
}

function createDocxBlob(title: string, content: string): Blob {
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim() ? paragraphXml(line) : '<w:p/>')
    .join('')

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphXml(`# ${title}`)}
    ${paragraphs}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`

  return createZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      content: documentXml,
    },
  ])
}

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

  // Get display label for artifact language
  const getLanguageLabel = (artifact: Artifact | null): string => {
    if (!artifact) return 'No artifact'

    const lang = artifact.language
    const code = artifact.code || ''

    // HTML artifacts with inline CSS/JS
    if (lang === 'html') {
      const hasCSS = code.includes('<style')
      const hasJS = code.includes('<script')

      if (hasCSS && hasJS) return 'HTML + CSS + JS'
      if (hasCSS) return 'HTML + CSS'
      if (hasJS) return 'HTML + JS'
      return 'HTML'
    }

    // React artifacts
    if (lang === 'tsx') return 'React / TSX'
    if (lang === 'jsx') return 'React / JSX'

    // Other languages
    if (lang === 'javascript') return 'JavaScript'
    if (lang === 'python') return 'Python'
    if (lang === 'css') return 'CSS'
    if (lang === 'markdown') return 'Markdown'
    if (lang === 'docx') return 'Microsoft Word'

    return lang.toUpperCase()
  }

  const renderPanelContent = () => (
    <div className="flex flex-col h-full" style={{ paddingLeft: isMobile ? 0 : '12px' }}>
      {/* Dev Debug Info */}
      {process.env.NODE_ENV !== 'production' && (
        <div className="bg-yellow-500/20 border-b border-yellow-500/50 p-2 text-xs text-yellow-300">
          Debug: Artifact loaded: {artifact ? 'YES' : 'NO'} | Language: {artifact?.language || 'N/A'} | Code length: {artifact?.code?.length || 0}
        </div>
      )}

      {/* Header */}
      <div className="bg-white/[0.02] border-b border-white/[0.06] p-4 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-white truncate">
            {artifact?.title || 'No Artifact'}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {artifact ? `${getLanguageLabel(artifact)} • Artifact` : 'No artifact selected'}
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
      <div className="bg-white/[0.02] border-b border-white/[0.06] px-4 flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          {canPreview && (
            <button
              onClick={() => setActiveTab('preview')}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2',
                currentTab === 'preview'
                  ? 'text-white border-violet-500'
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
                ? 'text-white border-violet-500'
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
                  ? 'bg-violet-500/15 text-violet-400'
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
                  ? 'bg-violet-500/15 text-violet-400'
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
                  ? 'bg-violet-500/15 text-violet-400'
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
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#08070d]">
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
                    : artifact.language === 'docx'
                      ? 'text'
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
        <div className="bg-white/[0.02] border-t border-white/[0.06] p-4 flex gap-3">
          <Button
            onClick={handleCopy}
            className="flex-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1]"
            variant="ghost"
          >
            <Copy className="h-4 w-4 mr-2" />
            {artifact.language === 'docx' ? 'Copy Content' : 'Copy Code'}
          </Button>
          <Button
            onClick={handleDownload}
            className="flex-1 bg-violet-600/80 hover:bg-violet-600 text-white"
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
      docx: 'docx',
    }

    const extension = extensions[artifact.language] || 'txt'
    const filename = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${extension}`

    const blob = artifact.language === 'docx'
      ? createDocxBlob(artifact.title, artifact.code)
      : new Blob([artifact.code], { type: 'text/plain' })
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
            className="fixed inset-0 z-50 bg-[#08070d] md:hidden"
          >
            {renderPanelContent()}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Desktop: Flex child */}
      {!isMobile && isOpen && (
        <aside
          ref={panelRef}
          className="hidden md:flex relative h-full min-h-0 flex-shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a10] shadow-2xl"
          style={{ width: `${currentWidth}px` }}
        >
          {/* Resize Handle - Desktop Only - Full Height */}
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group',
              'hover:bg-violet-500/5 transition-colors',
              isResizing && 'bg-violet-500/10'
            )}
            style={{
              zIndex: 100,
              pointerEvents: 'auto',
            }}
            onPointerDown={handleResizeStart}
          >
            {/* Vertical line spanning full height */}
            <div className={cn(
              'absolute left-1 w-px h-full bg-white/10 transition-colors',
              'group-hover:bg-violet-400/40',
              isResizing && 'bg-violet-400/60'
            )} />
            {/* Centered grip indicator */}
            <div className={cn(
              'absolute top-1/2 left-0.5 -translate-y-1/2 w-1.5 h-16 rounded-full bg-violet-400/40 transition-opacity',
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
