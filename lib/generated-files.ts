export type GeneratedFileKind = 'pptx' | 'gslides' | 'docx' | 'gdoc' | 'pdf'

export interface GeneratedFileIntent {
  kind: GeneratedFileKind
  label: string
  extension: 'pptx' | 'docx' | 'pdf'
  mimeType: string
}

const POWERPOINT_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME_TYPE = 'application/pdf'

const POWERPOINT_KEYWORDS = /\b(powerpoint|pptx|presentation|presentations|slides|slide deck|deck|google slides)\b/i
const DOCX_KEYWORDS = /\b(word document|word doc|docx|google docs|google doc|document export|document file)\b/i
const PDF_KEYWORDS = /\b(pdf|report export|pdf export|export as pdf|downloadable pdf)\b/i
const CANVA_PRESENTATION_KEYWORDS = /\b(canva-style|canva style|canva)\b/i
const INTERACTIVE_ARTIFACT_KEYWORDS = /\b(interactive|widget|calculator|tool|game|quiz|browser app|web app|landing page|website|html|react|tsx|jsx)\b/i
const FILE_DELIVERY_KEYWORDS = /\b(download|downloadable|export|file|formatted file|final file|save as|as a pdf|as pdf|into pdf)\b/i
const REPORT_KEYWORDS = /\b(report|audit|summary document)\b/i

export function normalizeGeneratedFileKind(value: string | null | undefined): GeneratedFileKind | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'pptx' || normalized === 'powerpoint' || normalized === 'presentation') return 'pptx'
  if (normalized === 'gslides' || normalized === 'google slides') return 'gslides'
  if (normalized === 'docx' || normalized === 'word' || normalized === 'document') return 'docx'
  if (normalized === 'gdoc' || normalized === 'google docs' || normalized === 'google doc') return 'gdoc'
  if (normalized === 'pdf') return 'pdf'
  return null
}

export function getGeneratedFileIntent(kind: GeneratedFileKind): GeneratedFileIntent {
  if (kind === 'pptx' || kind === 'gslides') {
    return {
      kind,
      label: kind === 'gslides' ? 'Google Slides-style presentation' : 'PowerPoint presentation',
      extension: 'pptx',
      mimeType: POWERPOINT_MIME_TYPE,
    }
  }

  if (kind === 'docx' || kind === 'gdoc') {
    return {
      kind,
      label: kind === 'gdoc' ? 'Google Docs-style document' : 'Word document',
      extension: 'docx',
      mimeType: DOCX_MIME_TYPE,
    }
  }

  return {
    kind,
    label: 'PDF document',
    extension: 'pdf',
    mimeType: PDF_MIME_TYPE,
  }
}

export function isGeneratedFileArtifactLanguage(language: string | null | undefined): language is GeneratedFileKind {
  return normalizeGeneratedFileKind(language) !== null
}

export function detectGeneratedFileIntent(message: string): GeneratedFileIntent | null {
  const text = String(message || '').trim()
  if (!text) return null
  const lower = text.toLowerCase()
  const hasExplicitFileDeliveryIntent = FILE_DELIVERY_KEYWORDS.test(lower)
  const looksLikeReportExportRequest = REPORT_KEYWORDS.test(lower) && hasExplicitFileDeliveryIntent

  if (INTERACTIVE_ARTIFACT_KEYWORDS.test(lower) && !POWERPOINT_KEYWORDS.test(lower) && !DOCX_KEYWORDS.test(lower) && !PDF_KEYWORDS.test(lower)) {
    return null
  }

  if (CANVA_PRESENTATION_KEYWORDS.test(lower) && POWERPOINT_KEYWORDS.test(lower)) {
    return getGeneratedFileIntent('pptx')
  }

  if (PDF_KEYWORDS.test(lower) || looksLikeReportExportRequest) return getGeneratedFileIntent('pdf')
  if (POWERPOINT_KEYWORDS.test(lower)) return getGeneratedFileIntent(/google slides/i.test(lower) ? 'gslides' : 'pptx')
  if (DOCX_KEYWORDS.test(lower)) return getGeneratedFileIntent(/google docs?/i.test(lower) ? 'gdoc' : 'docx')

  if (/\b(downloadable file|download file|export file|presentation export|slides export)\b/i.test(lower)) {
    return getGeneratedFileIntent('pdf')
  }

  return null
}

export function getGeneratedFileLabel(kind: GeneratedFileKind): string {
  return getGeneratedFileIntent(kind).label
}

export function getGeneratedFileExtension(kind: GeneratedFileKind): 'pptx' | 'docx' | 'pdf' {
  return getGeneratedFileIntent(kind).extension
}

export function getGeneratedFileMimeType(kind: GeneratedFileKind): string {
  return getGeneratedFileIntent(kind).mimeType
}

export function createGeneratedFileBaseName(title: string): string {
  const safe = String(title || 'generated-file')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return safe || 'generated-file'
}

export function createGeneratedFilename(title: string, kind: GeneratedFileKind): string {
  return `${createGeneratedFileBaseName(title)}.${getGeneratedFileExtension(kind)}`
}
