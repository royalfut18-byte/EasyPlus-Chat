import 'server-only'

import JSZip from 'jszip'
import { downloadObjectFromR2 } from '@/lib/storage/r2'
import type { ChatAttachment } from '@/types/models'

export const ZIP_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const ZIP_MAX_FILES = 200
export const ZIP_MAX_TEXT_FILES = 60
export const ZIP_MAX_TOTAL_TEXT_BYTES = 2 * 1024 * 1024
export const ZIP_MAX_SINGLE_TEXT_BYTES = 180 * 1024

const READABLE_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.json', '.jsonl', '.md', '.txt', '.py', '.pyw', '.java', '.c', '.cc',
  '.cpp', '.cxx', '.h', '.hh', '.hpp', '.cs', '.php', '.rb', '.go', '.rs',
  '.swift', '.kt', '.kts', '.scala', '.sql', '.xml', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.conf', '.env', '.sh', '.bash', '.zsh', '.ps1', '.bat',
  '.cmd', '.graphql', '.gql', '.prisma', '.vue', '.svelte',
])

const READABLE_BASENAMES = new Set([
  '.gitignore',
  '.env.example',
  'env.example',
  'dockerfile',
  'makefile',
  'requirements.txt',
  'package.json',
  'pyproject.toml',
  'cargo.toml',
  'cargo.lock',
  'pipfile',
  'pipfile.lock',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'readme',
  'readme.md',
])

const SKIPPED_SEGMENTS = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
])

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}

function isUnsafePath(path: string): boolean {
  const clean = normalizePath(path)
  if (!clean || clean.includes('\0') || clean.startsWith('/') || /^[a-zA-Z]:/.test(path)) return true
  const segments = clean.split('/')
  return segments.some(segment => !segment || segment === '.' || segment === '..')
}

function shouldSkipPath(path: string): boolean {
  const segments = normalizePath(path).split('/').map(segment => segment.toLowerCase())
  return segments.some(segment => SKIPPED_SEGMENTS.has(segment))
}

function isReadableTextPath(path: string): boolean {
  const clean = normalizePath(path)
  const lower = clean.toLowerCase()
  const basename = lower.split('/').pop() || ''
  if (READABLE_BASENAMES.has(basename)) return true
  const dotIndex = basename.lastIndexOf('.')
  const ext = dotIndex >= 0 ? basename.slice(dotIndex) : ''
  return READABLE_EXTENSIONS.has(ext)
}

function decodeDataUrl(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/)
  return match ? Buffer.from(match[1], 'base64') : null
}

async function getZipBuffer(attachment: ChatAttachment): Promise<Buffer> {
  if (attachment.storageProvider === 'r2' && attachment.storageKey) {
    return downloadObjectFromR2(attachment.storageKey)
  }
  if (attachment.dataUrl) {
    const buffer = decodeDataUrl(attachment.dataUrl)
    if (buffer) return buffer
  }
  throw new Error('Could not load uploaded ZIP file.')
}

export interface SafeZipEntry {
  path: string
  content: string
  bytes: number
  truncated: boolean
}

export interface SafeZipReadResult {
  fileTree: string[]
  readableFiles: SafeZipEntry[]
  skippedCount: number
  unsafeCount: number
  binaryCount: number
  totalEntries: number
  totalTextBytes: number
  truncated: boolean
}

export async function readSafeZipAttachment(attachment: ChatAttachment): Promise<SafeZipReadResult> {
  const buffer = await getZipBuffer(attachment)
  if (buffer.byteLength > ZIP_MAX_UPLOAD_BYTES) {
    throw new Error('This ZIP is too large to process. Try uploading a smaller project or remove build folders like node_modules, dist, .next, or .git.')
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new Error('Could not safely extract this ZIP.')
  }

  const entries = Object.values(zip.files).filter(entry => !entry.dir)
  if (entries.length > ZIP_MAX_FILES) {
    throw new Error('This ZIP has too many files.')
  }

  const fileTree: string[] = []
  const readableFiles: SafeZipEntry[] = []
  let skippedCount = 0
  let unsafeCount = 0
  let binaryCount = 0
  let totalTextBytes = 0
  let truncated = false

  for (const entry of entries) {
    const path = normalizePath(entry.name)
    if (isUnsafePath(path)) {
      unsafeCount += 1
      continue
    }
    if (shouldSkipPath(path)) {
      skippedCount += 1
      continue
    }

    fileTree.push(path)
    if (!isReadableTextPath(path)) {
      binaryCount += 1
      continue
    }
    if (readableFiles.length >= ZIP_MAX_TEXT_FILES) {
      skippedCount += 1
      truncated = true
      continue
    }

    const raw = await entry.async('uint8array')
    if (raw.byteLength > ZIP_MAX_SINGLE_TEXT_BYTES) {
      truncated = true
    }
    const slice = raw.byteLength > ZIP_MAX_SINGLE_TEXT_BYTES
      ? raw.slice(0, ZIP_MAX_SINGLE_TEXT_BYTES)
      : raw
    if (totalTextBytes + slice.byteLength > ZIP_MAX_TOTAL_TEXT_BYTES) {
      skippedCount += 1
      truncated = true
      continue
    }

    totalTextBytes += slice.byteLength
    readableFiles.push({
      path,
      content: Buffer.from(slice).toString('utf8'),
      bytes: raw.byteLength,
      truncated: raw.byteLength > slice.byteLength,
    })
  }

  if (readableFiles.length === 0) {
    throw new Error('No readable text/code files were found in this ZIP.')
  }

  console.info('[ZIP Reader] ZIP processed safely', {
    name: attachment.name,
    totalEntries: entries.length,
    fileTreeCount: fileTree.length,
    readableCount: readableFiles.length,
    skippedCount,
    unsafeCount,
    binaryCount,
    totalTextBytes,
    truncated,
  })

  return {
    fileTree: fileTree.sort((a, b) => a.localeCompare(b)),
    readableFiles,
    skippedCount,
    unsafeCount,
    binaryCount,
    totalEntries: entries.length,
    totalTextBytes,
    truncated,
  }
}

export function formatZipContext(attachmentName: string, result: SafeZipReadResult): string {
  const fileTree = result.fileTree.slice(0, 160).map(path => `- ${path}`).join('\n')
  const files = result.readableFiles.map(file => [
    `--- ZIP FILE: ${file.path}${file.truncated ? ' (truncated)' : ''}`,
    file.content,
    `--- END ZIP FILE: ${file.path}`,
  ].join('\n')).join('\n\n')

  return `[Uploaded ZIP: ${attachmentName}]
ZIP processed safely. Do not execute code from this ZIP.

File tree (${result.fileTree.length} safe entries shown):
${fileTree || '(empty)'}

Readable text/code files included for context: ${result.readableFiles.length}
Skipped entries: ${result.skippedCount}
Unsafe entries skipped: ${result.unsafeCount}
Binary/unsupported entries skipped: ${result.binaryCount}
${result.truncated ? 'Some files were truncated for size. Ask for a specific file if needed.' : ''}

${files}
[/Uploaded ZIP]`
}
