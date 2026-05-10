import type { Message, Artifact } from '@/types/models'
import { parseArtifactFromResponse } from './artifact-parser'

// Sort messages chronologically: oldest first, newest last
export function sortMessagesChronologically(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    // Primary sort: created_at ascending
    const timeA = new Date(a.created_at).getTime()
    const timeB = new Date(b.created_at).getTime()

    if (timeA !== timeB) {
      return timeA - timeB
    }

    // Secondary sort: user before assistant when times are equal
    if (a.role !== b.role) {
      return a.role === 'user' ? -1 : 1
    }

    // Tertiary sort: by id for stability
    return a.id.localeCompare(b.id)
  })
}

// Extended message with local artifact metadata
export interface ProcessedMessage extends Message {
  artifact?: Artifact | null
  displayContent?: string
}

// Parse artifacts from old messages
export function parseArtifactsFromMessages(
  messages: Message[],
  conversationId?: string
): ProcessedMessage[] {
  const processed: ProcessedMessage[] = []
  let latestArtifact: Artifact | null = null
  let latestArtifactMessageId: string | null = null

  for (const message of messages) {
    if (message.role === 'assistant' && message.content) {
      // Try to parse artifact from assistant message
      const { artifact, cleanContent } = parseArtifactFromResponse(
        message.content,
        true, // Always try to parse for old messages
        '' // No user prompt context
      )

      if (artifact) {
        // Found an artifact in old message
        console.log('[Message Utils] Found artifact in old message:', artifact.title)

        // Save to localStorage
        try {
          const artifactData = JSON.stringify(artifact)
          if (conversationId) {
            localStorage.setItem(`easyplus:artifact:${conversationId}:${message.id}`, artifactData)
            localStorage.setItem(`easyplus:artifact:${conversationId}:latest`, artifactData)
          }
        } catch (e) {
          console.error('[Message Utils] Failed to save artifact:', e)
        }

        // Track latest artifact
        latestArtifact = artifact
        latestArtifactMessageId = message.id

        // Ensure clean content is not empty
        let finalContent = cleanContent.trim()
        if (!finalContent) {
          finalContent = `I created an artifact for you: **${artifact.title}**.`
        }

        processed.push({
          ...message,
          artifact,
          displayContent: finalContent,
          content: finalContent, // Also update content for consistency
        })
      } else {
        // No artifact, use original content
        processed.push(message)
      }
    } else {
      // User message or empty assistant message
      processed.push(message)
    }
  }

  return processed
}

// Get stored artifact for a message
export function getStoredArtifact(conversationId: string, messageId?: string): Artifact | null {
  try {
    const key = messageId
      ? `easyplus:artifact:${conversationId}:${messageId}`
      : `easyplus:artifact:${conversationId}:latest`
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  } catch (e) {
    console.error('[Message Utils] Failed to load stored artifact:', e)
    return null
  }
}
