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
  const blockRegex = /```(?:generated_zip|generated-zip|zip_manifest)\s*\r?\n([\s\S]*?)```/i
  const match = content.match(blockRegex)
  if (!match) return { cleanContent: content, manifest: null }

  try {
    const parsed = JSON.parse(match[1].trim())
    const manifest = validateGeneratedZipManifest(parsed)
    const before = content.slice(0, match.index).trim()
    const after = content.slice((match.index || 0) + match[0].length).trim()
    const cleanContent = [before, `**Generated files:** ${manifest.filename}`, after]
      .filter(Boolean)
      .join('\n\n')

    return { cleanContent, manifest }
  } catch {
    const before = content.slice(0, match.index).trim()
    const after = content.slice((match.index || 0) + match[0].length).trim()
    return {
      cleanContent: [before, 'I could not prepare the downloadable ZIP from this response. Please try again.', after]
        .filter(Boolean)
        .join('\n\n'),
      manifest: null,
    }
  }
}

export function hideGeneratedZipManifestFromDisplay(content: string): string {
  const markerIndex = content.search(/```(?:generated_zip|generated-zip|zip_manifest)\b/i)
  if (markerIndex < 0) return content

  const visibleContent = content.slice(0, markerIndex).trimEnd()
  return `${visibleContent}${visibleContent ? '\n\n' : ''}_Preparing downloadable ZIP..._`
}
