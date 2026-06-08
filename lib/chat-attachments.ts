export const MAX_CHAT_ATTACHMENTS = 10
export const MAX_CHAT_IMAGE_ATTACHMENTS = 4
export const MAX_CHAT_EXTRACTED_TEXT_CHARS_PER_FILE = 40000
export const MAX_CHAT_TOTAL_EXTRACTED_TEXT_CHARS = 120000

export const CHAT_ATTACHMENT_UNSUPPORTED_ERROR =
  'Unsupported file type. Please upload an image, PDF, Office document, ZIP, or a common text/code/config file.'

export const CHAT_TEXT_ATTACHMENT_EXTENSION_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.rtf': 'application/rtf',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.jsonl': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.py': 'text/x-python',
  '.pyw': 'text/x-python',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cc': 'text/x-c++src',
  '.cpp': 'text/x-c++src',
  '.cxx': 'text/x-c++src',
  '.h': 'text/x-c',
  '.hh': 'text/x-c++hdr',
  '.hpp': 'text/x-c++hdr',
  '.cs': 'text/x-csharp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rustsrc',
  '.rb': 'application/x-ruby',
  '.php': 'application/x-httpd-php',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.kts': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  '.ps1': 'text/plain',
  '.bat': 'text/plain',
  '.cmd': 'text/plain',
  '.sql': 'application/sql',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.env': 'text/plain',
  '.log': 'text/plain',
  '.graphql': 'application/graphql',
  '.gql': 'application/graphql',
  '.prisma': 'text/plain',
  '.vue': 'text/plain',
  '.svelte': 'text/plain',
  '.ipynb': 'application/json',
  '.dockerignore': 'text/plain',
  '.gitignore': 'text/plain',
}

export const CHAT_TEXT_ATTACHMENT_BASENAME_TO_MIME: Record<string, string> = {
  'dockerfile': 'text/plain',
  'makefile': 'text/plain',
  '.gitignore': 'text/plain',
  '.dockerignore': 'text/plain',
  '.env': 'text/plain',
  '.env.example': 'text/plain',
  'requirements.txt': 'text/plain',
  'package.json': 'application/json',
  'tsconfig.json': 'application/json',
  'composer.json': 'application/json',
  'pyproject.toml': 'application/toml',
  'cargo.toml': 'application/toml',
  'cargo.lock': 'text/plain',
  'pipfile': 'text/plain',
  'pipfile.lock': 'text/plain',
  'readme': 'text/plain',
  'readme.md': 'text/markdown',
}

export const CHAT_ATTACHMENT_TOO_MANY_ERROR = 'Too many files uploaded at once.'
export const CHAT_ATTACHMENT_TOO_MANY_IMAGES_ERROR = `Too many images uploaded at once. Please upload up to ${MAX_CHAT_IMAGE_ATTACHMENTS} images per message.`
export const CHAT_ATTACHMENT_READ_ERROR = 'Could not read the uploaded file. Please re-upload it.'
export const CHAT_IMAGE_UNDERSTANDING_NOT_CONFIGURED_ERROR = 'Image understanding is not configured yet.'

export const SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.rtf',
  '.csv',
  '.json',
  '.jsonl',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.pyw',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.kts',
  '.scala',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.log',
  '.graphql',
  '.gql',
  '.prisma',
  '.vue',
  '.svelte',
  '.ipynb',
  '.dockerignore',
  '.gitignore',
  '.docx',
  '.xlsx',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.zip',
] as const

export const SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'text/x-typescript',
  'text/x-python',
  'application/x-python-code',
  'text/x-java-source',
  'text/x-c',
  'text/x-c++src',
  'text/x-c++hdr',
  'text/x-csharp',
  'text/x-go',
  'text/x-rustsrc',
  'application/x-ruby',
  'application/x-httpd-php',
  'text/x-swift',
  'text/x-kotlin',
  'text/x-scala',
  'application/x-sh',
  'application/sql',
  'application/xml',
  'text/xml',
  'application/yaml',
  'text/yaml',
  'application/x-yaml',
  'application/toml',
  'application/graphql',
  'application/rtf',
  'text/rtf',
  'application/msword',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
] as const

export const SUPPORTED_CHAT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const

export function normalizeChatAttachmentMimeType(mimeType?: string | null): string {
  const normalized = (mimeType || '').trim().toLowerCase()
  if (normalized === 'image/jpg') return 'image/jpeg'
  if (normalized === 'text/x-markdown') return 'text/markdown'
  if (normalized === 'application/msword') return 'application/rtf'
  if (normalized === 'application/x-typescript') return 'application/typescript'
  if (normalized === 'text/x-python-script') return 'text/x-python'
  if (normalized === 'text/x-shellscript') return 'application/x-sh'
  if (normalized === 'application/x-httpd-php-source') return 'application/x-httpd-php'
  if (normalized === 'text/x-java') return 'text/x-java-source'
  if (normalized === 'text/x-csrc') return 'text/x-c'
  if (normalized === 'text/x-c++') return 'text/x-c++src'
  if (normalized === 'text/x-script.python') return 'text/x-python'
  if (normalized === 'application/x-yml') return 'application/yaml'
  return normalized
}

export function getChatAttachmentExtension(filename?: string | null): string {
  const lower = (filename || '').trim().toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  return dotIndex >= 0 ? lower.slice(dotIndex) : ''
}

export function isSupportedChatAttachment(input: {
  filename?: string | null
  mimeType?: string | null
}): boolean {
  const ext = getChatAttachmentExtension(input.filename)
  const basename = (input.filename || '').trim().toLowerCase().split(/[\\/]/).pop() || ''
  const mimeType = normalizeChatAttachmentMimeType(input.mimeType)
  return SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS.includes(ext as (typeof SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS)[number]) ||
    Boolean(CHAT_TEXT_ATTACHMENT_BASENAME_TO_MIME[basename]) ||
    SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES.includes(mimeType as (typeof SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES)[number])
}

export function isSupportedChatImageMimeType(mimeType?: string | null): boolean {
  const normalized = normalizeChatAttachmentMimeType(mimeType)
  return SUPPORTED_CHAT_IMAGE_MIME_TYPES.includes(normalized as (typeof SUPPORTED_CHAT_IMAGE_MIME_TYPES)[number])
}

export function inferChatAttachmentMimeType(filename?: string | null, mimeType?: string | null): string {
  const normalizedMimeType = normalizeChatAttachmentMimeType(mimeType)
  if (
    normalizedMimeType &&
    normalizedMimeType !== 'application/octet-stream' &&
    normalizedMimeType !== 'binary/octet-stream'
  ) {
    return normalizedMimeType
  }

  const ext = getChatAttachmentExtension(filename)
  const basename = (filename || '').trim().toLowerCase().split(/[\\/]/).pop() || ''
  return CHAT_TEXT_ATTACHMENT_EXTENSION_TO_MIME[ext] ||
    CHAT_TEXT_ATTACHMENT_BASENAME_TO_MIME[basename] ||
    normalizedMimeType ||
    'application/octet-stream'
}

export function getAcceptedChatAttachmentExtensions(): string[] {
  return [...SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS]
}
