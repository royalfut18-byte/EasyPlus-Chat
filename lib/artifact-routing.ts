import type { Artifact } from '@/types/models'
import { detectGeneratedFileIntent } from '@/lib/generated-files'

const ARTIFACT_REFINEMENT_PATTERNS = [
  /\b(make it better|improve it|refine it|fix the buttons|fix the layout|change colors?|change colours?|add animations?|add more|make it mobile friendly|make it more interactive|update the artifact|edit the artifact)\b/i,
  /\b(add (more )?(questions|sections|tabs|cards|animations|interactions|features))\b/i,
]

const ARTIFACT_INTENT_PATTERNS = [
  /\binteractive\b/i,
  /\bartifact\b/i,
  /\bquiz\b/i,
  /\bcalculator\b/i,
  /\bflashcard\b/i,
  /\bstudy tool\b/i,
  /\bmini game\b/i,
  /\bplayable\b/i,
  /\btimeline\b/i,
  /\bwebsite component\b/i,
  /\bwidget\b/i,
  /\bhtml\b/i,
  /\bcss\b/i,
  /\bjavascript\b/i,
  /\bjsx\b/i,
  /\btsx\b/i,
  /\breact\b/i,
  /\bweb app\b/i,
  /\bwebsite\b/i,
  /\blanding page\b/i,
]

const ZIP_PIPELINE_PATTERNS = [
  /\bzip\b/i,
  /\bdownloadable project\b/i,
  /\bproject zip\b/i,
  /\bzip website project\b/i,
  /\bstarter project\b/i,
  /\bcodebase\b/i,
]

const EASY_CODE_PATTERNS = [
  /\beasy code\b/i,
  /\beasy code project\b/i,
]

export function detectZipProjectIntent(message: string): boolean {
  const text = String(message || '').trim()
  if (!text) return false
  return ZIP_PIPELINE_PATTERNS.some((pattern) => pattern.test(text))
}

export function detectArtifactRefinementIntent(message: string, currentArtifact?: Artifact | null): boolean {
  if (!currentArtifact) return false
  const text = String(message || '').trim()
  if (!text) return false
  return ARTIFACT_REFINEMENT_PATTERNS.some((pattern) => pattern.test(text))
}

export function detectArtifactIntent(message: string, currentArtifact?: Artifact | null): boolean {
  const text = String(message || '').trim()
  if (!text) return false

  if (detectGeneratedFileIntent(text)) return false
  if (detectZipProjectIntent(text)) return false
  if (EASY_CODE_PATTERNS.some((pattern) => pattern.test(text))) return false

  if (detectArtifactRefinementIntent(text, currentArtifact)) {
    return true
  }

  return ARTIFACT_INTENT_PATTERNS.some((pattern) => pattern.test(text))
}
