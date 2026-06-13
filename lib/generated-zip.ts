import type { Artifact, ChatAttachment } from '@/types/models'

export const MAX_ZIP_FILES = 100
export const MAX_ZIP_TOTAL_BYTES = 10 * 1024 * 1024
export const MAX_ZIP_FILE_BYTES = 2 * 1024 * 1024
export const MAX_ZIP_FILENAME_LENGTH = 100
export const MAX_ZIP_PATH_LENGTH = 180
export const MAX_ZIP_FOLDER_DEPTH = 10

export interface GeneratedZipFile {
  path: string
  content: string
}

export interface GeneratedZipManifest {
  type: 'generated_zip'
  filename: string
  files: GeneratedZipFile[]
}

export interface GeneratedZipPreview {
  entryPath: string
  code: string
  files: GeneratedZipFile[]
}

export interface GeneratedZipPreviewArtifact extends Artifact {
  zipPreviewFiles?: GeneratedZipFile[]
  zipPreviewPath?: string
}

const BLOCKED_SEGMENTS = new Set([
  '.env',
  '.git',
  '.ssh',
  '.vercel',
  'node_modules',
])

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function looksLikeEscapedMarkup(value: string): boolean {
  return /\\[nrt"]/.test(value) && /(?:<!DOCTYPE|<html\b|<body\b|<head\b|<main\b|<div\b|<section\b|<script\b|<style\b|<\/[a-z]+>)/i.test(value)
}

export function decodePossiblyEscapedText(value: string): string {
  let current = value

  for (let i = 0; i < 3; i++) {
    const trimmed = current.trim()
    if (!trimmed) break

    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (typeof parsed === 'string') {
          current = parsed
          continue
        }
      } catch {
        // Fall through to lightweight decoding below.
      }
    }

    if (looksLikeEscapedMarkup(current)) {
      const decoded = current
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\')

      if (decoded !== current) {
        current = decoded
        continue
      }
    }

    break
  }

  return current
}

function tryParseManifest(candidate: string): GeneratedZipManifest | null {
  try {
    return validateGeneratedZipManifest(JSON.parse(candidate.trim()))
  } catch {
    return null
  }
}

function findBalancedJsonObject(content: string, startIndex: number): { start: number; end: number; text: string } | null {
  let depth = 0
  let inString = false
  let isEscaped = false

  for (let index = startIndex; index < content.length; index++) {
    const char = content[index]

    if (inString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return {
          start: startIndex,
          end: index + 1,
          text: content.slice(startIndex, index + 1),
        }
      }
    }
  }

  return null
}

function findGeneratedZipManifestRange(content: string): { manifest: GeneratedZipManifest; start: number; end: number } | null {
  const blockRegex = /```(?:generated_zip|generated-zip|zip_manifest)\s*\r?\n([\s\S]*?)```/i
  const blockMatch = content.match(blockRegex)
  if (blockMatch) {
    const manifest = tryParseManifest(blockMatch[1])
    if (manifest) {
      return {
        manifest,
        start: blockMatch.index || 0,
        end: (blockMatch.index || 0) + blockMatch[0].length,
      }
    }
  }

  const typeRegex = /"type"\s*:\s*"generated_zip"/ig
  let match: RegExpExecArray | null

  while ((match = typeRegex.exec(content)) !== null) {
    let objectStart = content.lastIndexOf('{', match.index)

    while (objectStart >= 0) {
      const candidate = findBalancedJsonObject(content, objectStart)
      if (!candidate || candidate.end <= match.index) {
        objectStart = content.lastIndexOf('{', objectStart - 1)
        continue
      }

      const manifest = tryParseManifest(candidate.text)
      if (manifest) {
        return {
          manifest,
          start: candidate.start,
          end: candidate.end,
        }
      }

      objectStart = content.lastIndexOf('{', objectStart - 1)
    }
  }

  return null
}

function normalizeZipPath(path: string): string {
  const normalizedSegments: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      normalizedSegments.pop()
      continue
    }
    normalizedSegments.push(segment)
  }
  return normalizedSegments.join('/')
}

function resolveZipAssetPath(basePath: string, targetPath: string): string | null {
  const trimmed = targetPath.trim()
  if (!trimmed || /^(?:[a-z]+:)?\/\//i.test(trimmed) || /^(?:data:|mailto:|tel:|#)/i.test(trimmed)) return null

  const withoutHash = trimmed.split('#')[0]
  const withoutQuery = withoutHash.split('?')[0]
  if (!withoutQuery) return null

  const baseSegments = normalizeZipPath(basePath).split('/').slice(0, -1)
  const targetSegments = withoutQuery.startsWith('/')
    ? withoutQuery.replace(/^\/+/, '').split('/')
    : [...baseSegments, ...withoutQuery.split('/')]

  return normalizeZipPath(targetSegments.join('/'))
}

function chooseHtmlPreviewFile(files: GeneratedZipFile[]): GeneratedZipFile | null {
  const htmlFiles = files.filter((file) => /\.(?:html?|xhtml)$/i.test(file.path))
  if (htmlFiles.length === 0) return null

  return (
    htmlFiles.find((file) => /(^|\/)index\.html?$/i.test(file.path)) ||
    htmlFiles[0]
  )
}

function inlineHtmlAssets(entryPath: string, html: string, filesByPath: Map<string, string>): string {
  let result = html

  result = result.replace(
    /<link\b([^>]*?)rel=["']?stylesheet["']?([^>]*?)href=["']([^"']+)["']([^>]*)>/gi,
    (fullMatch, beforeRel, between, href, afterHref) => {
      const resolvedPath = resolveZipAssetPath(entryPath, href)
      if (!resolvedPath) return fullMatch

      const content = filesByPath.get(resolvedPath.toLowerCase())
      if (typeof content !== 'string') return fullMatch

      return `<style data-easyplus-inline="${resolvedPath}">\n${content}\n</style>`
    }
  )

  result = result.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (fullMatch, beforeSrc, src, afterSrc) => {
      const resolvedPath = resolveZipAssetPath(entryPath, src)
      if (!resolvedPath) return fullMatch

      const content = filesByPath.get(resolvedPath.toLowerCase())
      if (typeof content !== 'string') return fullMatch

      return `<script data-easyplus-inline="${resolvedPath}">\n${content}\n</script>`
    }
  )

  return result
}

export function buildGeneratedZipPreview(manifest: GeneratedZipManifest): GeneratedZipPreview | null {
  const files = manifest.files.map((file) => ({
    path: file.path,
    content: decodePossiblyEscapedText(file.content),
  }))
  const htmlFile = chooseHtmlPreviewFile(files)
  if (!htmlFile) return null

  const filesByPath = new Map(files.map((file) => [normalizeZipPath(file.path).toLowerCase(), file.content]))
  const previewHtml = inlineHtmlAssets(htmlFile.path, htmlFile.content, filesByPath)

  return {
    entryPath: htmlFile.path,
    code: previewHtml,
    files,
  }
}

function createGeneratedZipTitle(manifest: GeneratedZipManifest, preview: GeneratedZipPreview, userPrompt?: string): string {
  const normalizedPrompt = String(userPrompt || '').trim()
  if (normalizedPrompt) {
    return normalizedPrompt
      .replace(/^(make|build|create|generate|turn|convert|update|package|give me|send me)\s+/i, '')
      .replace(/\s+(as|into)\s+(a\s+)?zip(\s+file|\s+package)?$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Generated Website Preview'
  }

  const fallbackTitle = preview.entryPath
    .split('/')
    .pop()
    ?.replace(/\.(html?|xhtml)$/i, '')
    ?.replace(/[-_]+/g, ' ')
    .trim()

  return fallbackTitle || manifest.filename.replace(/\.zip$/i, '') || 'Generated Website Preview'
}

export function createGeneratedZipPreviewArtifact(
  manifest: GeneratedZipManifest,
  generatedAttachment?: ChatAttachment | null,
  userPrompt?: string
): GeneratedZipPreviewArtifact | null {
  const preview = buildGeneratedZipPreview(manifest)
  if (!preview) return null

  return {
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    title: createGeneratedZipTitle(manifest, preview, userPrompt),
    language: 'html',
    code: preview.code,
    generatedAttachment: generatedAttachment || undefined,
    createdAt: new Date().toISOString(),
    zipPreviewFiles: preview.files,
    zipPreviewPath: preview.entryPath,
  }
}

export function sanitizeZipFilename(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const withExtension = raw.toLowerCase().endsWith('.zip') ? raw : `${raw || 'generated-project'}.zip`
  const safe = withExtension
    .replace(/[^a-zA-Z0-9._() -]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, MAX_ZIP_FILENAME_LENGTH)

  return safe.toLowerCase().endsWith('.zip') ? safe : `${safe.slice(0, MAX_ZIP_FILENAME_LENGTH - 4)}.zip`
}

export function validateGeneratedZipManifest(input: unknown): GeneratedZipManifest {
  if (!input || typeof input !== 'object') {
    throw new Error('A ZIP file manifest is required.')
  }

  const manifest = input as Record<string, unknown>
  if (manifest.type !== 'generated_zip' || !Array.isArray(manifest.files)) {
    throw new Error('The generated ZIP manifest is invalid.')
  }

  if (manifest.files.length === 0) {
    throw new Error('The ZIP package must contain at least one file.')
  }

  if (manifest.files.length > MAX_ZIP_FILES) {
    throw new Error('This package is too large to generate as a zip. Please reduce the number or size of files.')
  }

  const files: GeneratedZipFile[] = []
  const seenPaths = new Set<string>()
  let totalBytes = 0

  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Each ZIP entry must include a path and content.')
    }

    const rawPath = String((entry as Record<string, unknown>).path || '').trim()
    const content = String((entry as Record<string, unknown>).content ?? '')

    if (
      !rawPath ||
      rawPath.length > MAX_ZIP_PATH_LENGTH ||
      rawPath.includes('\0') ||
      rawPath.includes('\\') ||
      rawPath.startsWith('/') ||
      /^[a-zA-Z]:/.test(rawPath)
    ) {
      throw new Error(`Unsafe ZIP path: ${rawPath || '(empty)'}`)
    }

    const segments = rawPath.split('/')
    if (
      segments.length > MAX_ZIP_FOLDER_DEPTH + 1 ||
      segments.some(segment => !segment || segment === '.' || segment === '..') ||
      segments.some(segment => !/^[a-zA-Z0-9._@+() -]+$/.test(segment)) ||
      segments.some(segment => BLOCKED_SEGMENTS.has(segment.toLowerCase()))
    ) {
      throw new Error(`Unsafe ZIP path: ${rawPath}`)
    }

    const canonicalPath = segments.join('/')
    if (seenPaths.has(canonicalPath.toLowerCase())) {
      throw new Error(`Duplicate ZIP path: ${canonicalPath}`)
    }

    const contentBytes = byteLength(content)
    if (contentBytes > MAX_ZIP_FILE_BYTES) {
      throw new Error('This package is too large to generate as a zip. Please reduce the number or size of files.')
    }

    totalBytes += contentBytes
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error('This package is too large to generate as a zip. Please reduce the number or size of files.')
    }

    seenPaths.add(canonicalPath.toLowerCase())
    files.push({ path: canonicalPath, content })
  }

  return {
    type: 'generated_zip',
    filename: sanitizeZipFilename(manifest.filename),
    files,
  }
}

export function parseGeneratedZipFromResponse(content: string): {
  cleanContent: string
  manifest: GeneratedZipManifest | null
} {
  const match = findGeneratedZipManifestRange(content)
  if (!match) return { cleanContent: content, manifest: null }

  const before = content.slice(0, match.start).trim()
  const after = content.slice(match.end).trim()
  const cleanContent = [before, `**Generated files:** ${match.manifest.filename}`, after]
    .filter(Boolean)
    .join('\n\n')

  return {
    cleanContent,
    manifest: match.manifest,
  }
}

export function hideGeneratedZipManifestFromDisplay(content: string): string {
  const match = findGeneratedZipManifestRange(content)
  if (!match) return content

  const visibleContent = content.slice(0, match.start).trimEnd()
  return `${visibleContent}${visibleContent ? '\n\n' : ''}_Preparing downloadable ZIP..._`
}
