'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Download, Copy, ZoomIn, RotateCcw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/use-toast'

export interface GeneratedImage {
  id: string
  prompt: string
  imageUrl: string
  downloadUrl: string
  format: 'png' | 'jpg' | 'jpeg'
  mimeType: string
  sizeBytes: number
  filename: string
  createdAt: Date
}

interface ImageGenerationPanelProps {
  onGenerate: (prompt: string, aspectRatio?: string) => Promise<void>
  isGenerating: boolean
  generatedImages: GeneratedImage[]
  onRegenerate?: (imageId: string) => Promise<void>
}

export function ImageGenerationPanel({
  onGenerate,
  isGenerating,
  generatedImages,
  onRegenerate,
}: ImageGenerationPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<string>('1:1')
  const [isExpanded, setIsExpanded] = useState(false)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  const aspectRatios = [
    { label: '1:1 (Square)', value: '1:1' },
    { label: '16:9 (Landscape)', value: '16:9' },
    { label: '9:16 (Portrait)', value: '9:16' },
    { label: '4:3', value: '4:3' },
    { label: '3:4', value: '3:4' },
  ]

  const examplePrompts = [
    'A futuristic AI workspace dashboard',
    'A luxury black and purple app icon',
    'A cinematic bakery storefront at night',
    'A poster with bold readable text',
    'A realistic product photo on a dark background',
  ]

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({
        title: 'Empty prompt',
        description: 'Please describe the image you want to create.',
        variant: 'destructive',
      })
      return
    }

    try {
      await onGenerate(prompt, aspectRatio)
      setPrompt('')
      setIsExpanded(false)
    } catch (error: any) {
      toast({
        title: 'Generation failed',
        description: error.message || 'Could not generate image. Please try again.',
        variant: 'destructive',
      })
    }
  }

  const handleExampleClick = (example: string) => {
    setPrompt(example)
    setIsExpanded(true)
    setTimeout(() => textAreaRef.current?.focus(), 0)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden h-full">
      {/* Empty state or generated images */}
      <div className="flex-1 overflow-y-auto">
        {generatedImages.length === 0 && !isGenerating ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-4 py-8">
            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <div className="rounded-full bg-violet-500/10 p-3">
                  <Sparkles className="h-8 w-8 text-violet-400" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold text-white">Create images with AI</h2>
              <p className="mt-2 text-sm text-gray-400">
                Describe what you want and generate high-quality images in seconds.
              </p>
            </div>

            {/* Example prompts */}
            <div className="w-full max-w-2xl space-y-2">
              <p className="text-xs font-medium text-gray-500">Try examples:</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {examplePrompts.map((example, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleExampleClick(example)}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-xs text-gray-300 transition-all hover:border-violet-400/30 hover:bg-violet-500/5"
                  >
                    <p className="line-clamp-2">{example}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <AnimatePresence mode="popLayout">
              {isGenerating && <ImageGenerationSkeleton key="image-generation-skeleton" />}
              {generatedImages.map((image) => (
                <ImageResultCard
                  key={image.id}
                  image={image}
                  onRegenerate={onRegenerate}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Image prompt input at bottom */}
      <div className="border-t border-white/[0.06] bg-[#0f0f0f]/95 backdrop-blur-md">
        <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          <div className="space-y-3">
            {/* Aspect ratio selector */}
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-2"
              >
                <label className="text-xs font-medium text-gray-400">Aspect ratio:</label>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {aspectRatios.map((ratio) => (
                    <button
                      key={ratio.value}
                      onClick={() => setAspectRatio(ratio.value)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                        aspectRatio === ratio.value
                          ? 'border-violet-400/40 bg-violet-500/10 text-violet-200'
                          : 'border-white/[0.08] bg-white/[0.02] text-gray-400 hover:border-white/[0.12] hover:bg-white/[0.05]'
                      )}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Prompt input */}
            <div className="relative">
              <textarea
                ref={textAreaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => setIsExpanded(true)}
                placeholder="Describe the image you want to create..."
                className={cn(
                  'w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-base text-white placeholder:text-gray-500 transition-all focus:border-violet-400/40 focus:bg-white/[0.05] focus:outline-none focus:ring-1 focus:ring-violet-400/20',
                  isExpanded ? 'min-h-24' : 'min-h-12'
                )}
              />
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className={cn(
                'w-full rounded-lg px-4 py-3 font-medium text-white transition-all flex items-center justify-center gap-2',
                isGenerating || !prompt.trim()
                  ? 'bg-violet-500/40 cursor-not-allowed text-gray-300'
                  : 'bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 shadow-lg shadow-violet-500/20'
              )}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Image
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ImageGenerationSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="overflow-hidden rounded-xl border border-violet-400/15 bg-white/[0.02]"
    >
      <div className="aspect-square animate-pulse bg-gradient-to-br from-violet-500/15 via-white/[0.04] to-pink-500/10" />
      <div className="space-y-3 p-4">
        <div className="h-3 w-28 animate-pulse rounded-full bg-white/[0.08]" />
        <div className="h-3 w-3/4 animate-pulse rounded-full bg-white/[0.06]" />
        <p className="text-xs text-gray-400">Creating your image...</p>
      </div>
    </motion.div>
  )
}

interface ImageResultCardProps {
  image: GeneratedImage
  onRegenerate?: (imageId: string) => Promise<void>
}

function ImageResultCard({ image, onRegenerate }: ImageResultCardProps) {
  const [isRegenerating, setIsRegenerating] = useState(false)

  const handleDownload = async (format: 'png' | 'jpeg') => {
    try {
      if (format === 'png') {
        window.location.assign(image.downloadUrl)
        return
      }

      const response = await fetch(image.imageUrl)
      if (!response.ok) throw new Error('Image download failed')
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image conversion failed')
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const jpegBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!jpegBlob) throw new Error('Image conversion failed')
      const url = window.URL.createObjectURL(jpegBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = image.filename.replace(/\.png$/i, '.jpeg')
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast({
        title: 'Download started',
        description: 'Your image is being downloaded.',
      })
    } catch (error) {
      toast({
        title: 'Download failed',
        description: 'Could not download the image.',
        variant: 'destructive',
      })
    }
  }

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(image.prompt)
      toast({
        title: 'Copied',
        description: 'Prompt copied to clipboard.',
      })
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy prompt.',
        variant: 'destructive',
      })
    }
  }

  const handleRegenerate = async () => {
    if (!onRegenerate) return
    setIsRegenerating(true)
    try {
      await onRegenerate(image.id)
    } finally {
      setIsRegenerating(false)
    }
  }

  const handleOpenFullSize = () => {
    const link = document.createElement('a')
    link.href = image.imageUrl
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="group overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-sm"
    >
      {/* Image */}
      <div className="relative overflow-hidden bg-black">
        <img
          src={image.imageUrl}
          alt={image.prompt}
          className="h-auto w-full"
        />
        <button
          onClick={handleOpenFullSize}
          className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          title="Open full size"
        >
          <ZoomIn className="h-4 w-4 text-white" />
        </button>
      </div>

      {/* Details */}
      <div className="space-y-3 p-4">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Prompt</p>
          <p className="text-sm text-gray-300 line-clamp-2">{image.prompt}</p>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{new Date(image.createdAt).toLocaleTimeString()}</span>
          <span>{(image.sizeBytes / 1024).toFixed(0)} KB</span>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            onClick={() => handleDownload('png')}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs font-medium text-gray-300 transition-all hover:border-white/[0.12] hover:bg-white/[0.05]"
            title="Download PNG"
          >
            <Download className="h-3.5 w-3.5" />
            <span>PNG</span>
          </button>

          <button
            onClick={() => handleDownload('jpeg')}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs font-medium text-gray-300 transition-all hover:border-white/[0.12] hover:bg-white/[0.05]"
            title="Download JPEG"
          >
            <Download className="h-3.5 w-3.5" />
            <span>JPEG</span>
          </button>

          <button
            onClick={handleCopyPrompt}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs font-medium text-gray-300 transition-all hover:border-white/[0.12] hover:bg-white/[0.05]"
            title="Copy prompt"
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Copy</span>
          </button>

          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs font-medium text-gray-300 transition-all hover:border-white/[0.12] hover:bg-white/[0.05] disabled:opacity-50 disabled:cursor-not-allowed"
            title="Regenerate"
          >
            <RotateCcw className={cn('h-3.5 w-3.5', isRegenerating && 'animate-spin')} />
            <span className="hidden sm:inline">Again</span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}
