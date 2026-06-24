'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, ExternalLink, ImageIcon, Loader2, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ImageGenerationSize = '1024x1024' | '1024x1536' | '1536x1024'

export interface GeneratedImage {
  id: string
  attachmentId: string
  conversationId: string
  prompt: string
  size: ImageGenerationSize
  imageUrl: string
  downloadUrl: string
  filename: string
  mimeType: string
  sizeBytes: number
  format: 'png'
  mode: 'text_to_image' | 'image_edit'
  referenceAttachmentId?: string | null
  createdAt: string
}

export interface ImageGenerationOptions {
  forceNewImage?: boolean
  usePreviousImage?: boolean
  referenceImageAttachmentId?: string
}

const SIZE_OPTIONS: Array<{ value: ImageGenerationSize; label: string; description: string }> = [
  { value: '1024x1024', label: 'Square', description: '1024 x 1024' },
  { value: '1024x1536', label: 'Portrait', description: '1024 x 1536' },
  { value: '1536x1024', label: 'Landscape', description: '1536 x 1024' },
]

const EXAMPLE_PROMPTS = [
  'A cinematic product photo of futuristic headphones on black marble',
  'A cozy cyberpunk study room with neon rain outside',
  'A premium app icon for an AI workspace, glassmorphism style',
]

interface ImageGenerationPanelProps {
  generatedImages: GeneratedImage[]
  isGenerating: boolean
  onGenerate: (prompt: string, size: ImageGenerationSize, options?: ImageGenerationOptions) => Promise<void>
  onRegenerate: (image: GeneratedImage) => Promise<void>
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'PNG'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function ImageGenerationPanel({
  generatedImages,
  isGenerating,
  onGenerate,
  onRegenerate,
}: ImageGenerationPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<ImageGenerationSize>('1024x1024')
  const [usePreviousImage, setUsePreviousImage] = useState(false)
  const [referenceImageAttachmentId, setReferenceImageAttachmentId] = useState<string | null>(null)
  const canGenerate = prompt.trim().length >= 3 && !isGenerating
  const latestImages = useMemo(() => [...generatedImages].reverse(), [generatedImages])
  const hasPreviousImage = generatedImages.length > 0

  useEffect(() => {
    if (hasPreviousImage) setUsePreviousImage(true)
  }, [hasPreviousImage])

  const submit = async () => {
    if (!canGenerate) return
    await onGenerate(prompt.trim(), size, {
      forceNewImage: !usePreviousImage,
      usePreviousImage,
      referenceImageAttachmentId: referenceImageAttachmentId || undefined,
    }).catch(() => {})
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#1c1714] shadow-2xl shadow-black/20"
      >
        <div className="relative border-b border-white/[0.06] p-4 sm:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(236,72,153,0.16),transparent_38%),radial-gradient(circle_at_top_right,rgba(217,119,87,0.12),transparent_34%)]" />
          <div className="relative flex flex-col gap-3">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-pink-300/15 bg-pink-500/10 px-3 py-1 text-xs font-medium text-pink-100">
              <Sparkles className="h-3.5 w-3.5" />
              Image Generation
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Create images with AI
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400 sm:text-base">
                Describe what you want and generate high-quality images in seconds.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <div className="rounded-3xl border border-white/[0.08] bg-[#13110f] p-3 focus-within:border-pink-300/25 sm:p-4">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the image you want to create..."
              disabled={isGenerating}
              rows={5}
              className="min-h-[132px] w-full resize-none border-0 bg-transparent text-base leading-relaxed text-white outline-none placeholder:text-gray-500 disabled:opacity-60"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSize(option.value)}
                disabled={isGenerating}
                className={cn(
                  'rounded-2xl border px-4 py-3 text-left transition-colors',
                  size === option.value
                    ? 'border-pink-300/30 bg-pink-500/10 text-white'
                    : 'border-white/[0.08] bg-white/[0.025] text-gray-300 hover:bg-white/[0.05]',
                  isGenerating && 'cursor-not-allowed opacity-60'
                )}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{option.description}</span>
              </button>
            ))}
          </div>

          {hasPreviousImage && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setUsePreviousImage(true)}
                disabled={isGenerating}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  usePreviousImage
                    ? 'border-pink-300/30 bg-pink-500/10 text-pink-100'
                    : 'border-white/[0.08] bg-white/[0.025] text-gray-400 hover:bg-white/[0.06]',
                  isGenerating && 'cursor-not-allowed opacity-60'
                )}
              >
                Continue from previous image
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsePreviousImage(false)
                  setReferenceImageAttachmentId(null)
                }}
                disabled={isGenerating}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  !usePreviousImage
                    ? 'border-white/20 bg-white/[0.08] text-white'
                    : 'border-white/[0.08] bg-white/[0.025] text-gray-400 hover:bg-white/[0.06]',
                  isGenerating && 'cursor-not-allowed opacity-60'
                )}
              >
                New image
              </button>
              {usePreviousImage && (
                <span className="inline-flex items-center gap-1.5 text-xs text-pink-100/80">
                  <WandSparkles className="h-3.5 w-3.5" />
                  Using previous image as reference
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                disabled={isGenerating}
                className="rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canGenerate}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-pink-600 text-sm font-semibold text-white transition-colors hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-6"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating image...
              </>
            ) : (
              <>
                <ImageIcon className="h-4 w-4" />
                Generate Image
              </>
            )}
          </button>
        </div>
      </motion.section>

      <div className="grid gap-4">
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              key="image-loading"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-[28px] border border-white/[0.08] bg-[#1c1714] p-4 sm:p-5"
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr]">
                <div className="aspect-square overflow-hidden rounded-3xl border border-white/[0.08] bg-[#111]">
                  <div className="h-full w-full animate-pulse bg-[linear-gradient(110deg,rgba(255,255,255,0.03),rgba(236,72,153,0.12),rgba(255,255,255,0.03))] bg-[length:200%_100%]" />
                </div>
                <div className="flex flex-col justify-center gap-3">
                  <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1 text-xs text-gray-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-pink-300" />
                    Creating your image...
                  </div>
                  <div className="h-4 w-4/5 animate-pulse rounded bg-white/[0.08]" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                  <p className="max-w-md text-sm leading-relaxed text-gray-500">
                    Building the image, preparing the preview, and saving a private PNG for download.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {latestImages.length === 0 && !isGenerating ? (
          <div className="rounded-[28px] border border-dashed border-white/[0.10] bg-white/[0.02] p-8 text-center">
            <ImageIcon className="mx-auto h-10 w-10 text-gray-500" />
            <p className="mt-3 text-sm font-medium text-gray-300">Your generated images will appear here.</p>
            <p className="mt-1 text-xs text-gray-500">PNG downloads are stored privately and opened through your EasyPlus session.</p>
          </div>
        ) : (
          latestImages.map((image) => (
            <motion.article
              key={image.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#1c1714]"
            >
              <div className="grid gap-0 lg:grid-cols-[minmax(0,520px)_1fr]">
                <a
                  href={image.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-black/30"
                >
                  <img
                    src={image.imageUrl}
                    alt={image.prompt}
                    className="h-full max-h-[680px] w-full object-contain"
                  />
                </a>
                <div className="flex flex-col gap-4 border-t border-white/[0.06] p-4 lg:border-l lg:border-t-0 sm:p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-pink-200/70">Prompt</p>
                    <p className="mt-2 text-sm leading-relaxed text-gray-200">{image.prompt}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-white/[0.04] px-2.5 py-1">{image.size}</span>
                    <span className="rounded-full bg-white/[0.04] px-2.5 py-1">PNG</span>
                    <span className="rounded-full bg-white/[0.04] px-2.5 py-1">{formatBytes(image.sizeBytes)}</span>
                    {image.mode === 'image_edit' && (
                      <span className="rounded-full bg-pink-500/10 px-2.5 py-1 text-pink-200">Edited from previous image</span>
                    )}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <a
                      href={image.downloadUrl}
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-white text-xs font-semibold text-black px-3 transition-colors hover:bg-gray-200"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download PNG
                    </a>
                    <a
                      href={image.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.10] px-3 text-xs font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </a>
                    <button
                      type="button"
                      onClick={() => onRegenerate(image).catch(() => {})}
                      disabled={isGenerating}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.10] px-3 text-xs font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReferenceImageAttachmentId(image.attachmentId)
                        setUsePreviousImage(true)
                      }}
                      disabled={isGenerating}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.10] px-3 text-xs font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <WandSparkles className="h-3.5 w-3.5" />
                      Use as reference
                    </button>
                  </div>
                </div>
              </div>
            </motion.article>
          ))
        )}
      </div>
    </div>
  )
}
