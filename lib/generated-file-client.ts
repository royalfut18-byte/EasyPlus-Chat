import type { Artifact, ChatAttachment } from '@/types/models'
import { isGeneratedFileArtifactLanguage } from '@/lib/generated-files'

export async function createGeneratedFileAttachment(input: {
  artifact: Artifact
  conversationId?: string | null
  projectId?: string | null
  requestId?: string | null
}): Promise<{ attachment: ChatAttachment; downloadUrl: string; previewText?: string | null }> {
  if (!isGeneratedFileArtifactLanguage(input.artifact.language)) {
    throw new Error('This artifact type is not supported for real file generation.')
  }

  const response = await fetch('/api/generated-files/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.artifact.title,
      language: input.artifact.language,
      content: input.artifact.code,
      conversationId: input.conversationId || null,
      projectId: input.projectId || null,
      requestId: input.requestId || null,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.attachment) {
    throw new Error(data?.error || 'The file could not be generated correctly. Please try again.')
  }

  return {
    attachment: data.attachment as ChatAttachment,
    downloadUrl: String(data.downloadUrl || ''),
    previewText: typeof data.previewText === 'string' ? data.previewText : null,
  }
}

