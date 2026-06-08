import fs from 'node:fs'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const attachmentSource = fs.readFileSync('lib/chat-attachments.ts', 'utf8')
const extractSource = fs.readFileSync('lib/ai/document-extract.ts', 'utf8')
const presignSource = fs.readFileSync('app/api/upload/presign/route.ts', 'utf8')
const serverUploadSource = fs.readFileSync('app/api/upload/server-upload/route.ts', 'utf8')
const chatPageSource = fs.readFileSync('app/chat/page.tsx', 'utf8')

assert(
  attachmentSource.includes("'.py': 'text/x-python'"),
  'Attachment registry must support Python files'
)

assert(
  attachmentSource.includes("'.ts': 'application/typescript'"),
  'Attachment registry must support TypeScript files'
)

assert(
  attachmentSource.includes("'.yaml': 'application/yaml'"),
  'Attachment registry must support YAML files'
)

assert(
  attachmentSource.includes("'.zip'"),
  'Attachment registry must continue supporting ZIP files'
)

assert(
  extractSource.includes('isTextLikeAttachment'),
  'Document extraction must detect generic text/code attachments'
)

assert(
  presignSource.includes('isSupportedChatAttachment') && presignSource.includes('inferChatAttachmentMimeType'),
  'Presign route must validate attachments using shared filename+MIME resolution'
)

assert(
  serverUploadSource.includes('isSupportedChatAttachment') && serverUploadSource.includes('inferChatAttachmentMimeType'),
  'Server upload route must validate attachments using shared filename+MIME resolution'
)

assert(
  chatPageSource.includes('isSupportedChatAttachment({ filename: file.name, mimeType: mime })'),
  'Chat upload UI must use shared attachment validation'
)

console.log('PASS attachment support includes common code/config files and shared validation across upload paths')
