import 'server-only'

import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  createGeneratedFilename,
  getGeneratedFileExtension,
  getGeneratedFileLabel,
  getGeneratedFileMimeType,
  normalizeGeneratedFileKind,
  type GeneratedFileKind,
} from '@/lib/generated-files'

export interface PresentationSlideSpec {
  title: string
  bullets: string[]
  speakerNotes?: string
}

export interface PresentationSpec {
  title: string
  subtitle?: string
  theme?: {
    style?: string
    accentColor?: string
  }
  slides: PresentationSlideSpec[]
}

export interface DocumentSectionSpec {
  heading?: string
  paragraphs: string[]
  bullets: string[]
  table?: {
    headers: string[]
    rows: string[][]
  }
}

export interface DocumentSpec {
  title: string
  subtitle?: string
  sections: DocumentSectionSpec[]
}

export interface GeneratedBinaryFile {
  buffer: Buffer
  extension: 'pptx' | 'docx' | 'pdf'
  filename: string
  kind: GeneratedFileKind
  label: string
  mimeType: string
  previewText: string
  byteSize: number
  validation: {
    valid: boolean
    format: 'pptx' | 'docx' | 'pdf'
    entriesChecked: string[]
    slideCount?: number
    sectionCount?: number
    reason?: string | null
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseLooseJson(content: string): Record<string, any> | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function toParagraphs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }

  return String(value || '')
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
}

function toBullets(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }

  return String(value || '')
    .split(/\r?\n/)
    .map(item => item.replace(/^[-*\u2022â€¢]\s*/, '').trim())
    .filter(Boolean)
}

function normalizePresentationSpec(title: string, content: string): PresentationSpec {
  const parsed = parseLooseJson(content)
  if (parsed && Array.isArray(parsed.slides)) {
    const slides = parsed.slides
      .map((slide) => {
        const record = isRecord(slide) ? slide : {}
        const bullets = [
          ...toBullets(record.bullets),
          ...toParagraphs(record.paragraphs),
        ].filter(Boolean)
        return {
          title: String(record.title || '').trim(),
          bullets,
          speakerNotes: String(record.speakerNotes || '').trim() || undefined,
        }
      })
      .filter((slide) => slide.title || slide.bullets.length > 0)

    if (slides.length > 0) {
      return {
        title: String(parsed.title || title || 'Presentation').trim(),
        subtitle: String(parsed.subtitle || '').trim() || undefined,
        theme: isRecord(parsed.theme)
          ? {
              style: String(parsed.theme.style || '').trim() || undefined,
              accentColor: String(parsed.theme.accentColor || '#3B82F6').trim() || '#3B82F6',
            }
          : undefined,
        slides: slides.map((slide, index) => ({
          title: slide.title || `Slide ${index + 1}`,
          bullets: slide.bullets.length > 0 ? slide.bullets : ['Summary point'],
          speakerNotes: slide.speakerNotes,
        })),
      }
    }
  }

  const blocks = content
    .split(/\n\s*---+\s*\n/g)
    .map(block => block.trim())
    .filter(Boolean)

  const slides = (blocks.length > 0 ? blocks : [content]).map((block, index) => {
    const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const heading = lines[0]?.replace(/^#+\s*/, '').replace(/^slide\s*\d+\s*[:.-]\s*/i, '') || `${title} ${index + 1}`
    const bullets = lines.slice(1).map(line => line.replace(/^[-*\u2022â€¢]\s*/, '').trim()).filter(Boolean)
    return {
      title: heading,
      bullets: bullets.length > 0 ? bullets : [block.trim()],
    }
  })

  return {
    title: title || 'Presentation',
    slides,
  }
}

function parseMarkdownTable(lines: string[], startIndex: number): { table: DocumentSectionSpec['table']; nextIndex: number } | null {
  const first = lines[startIndex]
  const second = lines[startIndex + 1]
  if (!first || !second || !first.includes('|') || !second.includes('|')) return null
  const separatorCells = second.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
  if (!separatorCells.every(cell => /^:?-{3,}:?$/.test(cell))) return null

  const headers = first.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
  const rows: string[][] = []
  let index = startIndex + 2

  while (index < lines.length && lines[index].includes('|')) {
    rows.push(lines[index].replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()))
    index += 1
  }

  return {
    table: { headers, rows },
    nextIndex: index,
  }
}

function normalizeDocumentSpec(title: string, content: string): DocumentSpec {
  const parsed = parseLooseJson(content)
  if (parsed && Array.isArray(parsed.sections)) {
    const sections = parsed.sections
      .map((section) => {
        const record = isRecord(section) ? section : {}
        const table = isRecord(record.table) && Array.isArray(record.table.headers) && Array.isArray(record.table.rows)
          ? {
              headers: record.table.headers.map((item: unknown) => String(item || '').trim()).filter(Boolean),
              rows: record.table.rows.map((row: unknown) => Array.isArray(row) ? row.map((item) => String(item || '').trim()) : []).filter((row: string[]) => row.length > 0),
            }
          : undefined
        return {
          heading: String(record.heading || record.title || '').trim() || undefined,
          paragraphs: toParagraphs(record.paragraphs || record.content),
          bullets: toBullets(record.bullets),
          table,
        }
      })
      .filter((section) => section.heading || section.paragraphs.length > 0 || section.bullets.length > 0 || section.table)

    if (sections.length > 0) {
      return {
        title: String(parsed.title || title || 'Document').trim(),
        subtitle: String(parsed.subtitle || '').trim() || undefined,
        sections,
      }
    }
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const sections: DocumentSectionSpec[] = []
  let current: DocumentSectionSpec = { paragraphs: [], bullets: [] }
  let index = 0

  const pushCurrent = () => {
    if (current.heading || current.paragraphs.length > 0 || current.bullets.length > 0 || current.table) {
      sections.push(current)
    }
    current = { paragraphs: [], bullets: [] }
  }

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const table = parseMarkdownTable(lines, index)
    if (table) {
      current.table = table.table
      index = table.nextIndex
      continue
    }

    const headingMatch = line.match(/^#{1,3}\s+(.+)$/)
    if (headingMatch) {
      pushCurrent()
      current.heading = headingMatch[1].trim()
      index += 1
      continue
    }

    if (/^[-*\u2022â€¢]\s+/.test(line)) {
      current.bullets.push(line.replace(/^[-*\u2022â€¢]\s+/, '').trim())
      index += 1
      continue
    }

    current.paragraphs.push(line)
    index += 1
  }

  pushCurrent()

  if (sections.length === 0) {
    sections.push({
      heading: title,
      paragraphs: toParagraphs(content),
      bullets: [],
    })
  }

  return {
    title: title || 'Document',
    sections,
  }
}

function buildPresentationPreviewText(spec: PresentationSpec): string {
  return JSON.stringify(spec, null, 2)
}

function buildDocumentPreviewText(spec: DocumentSpec): string {
  return JSON.stringify(spec, null, 2)
}

function pickAccentColor(spec: PresentationSpec): string {
  const raw = spec.theme?.accentColor?.trim()
  return /^#[0-9a-f]{6}$/i.test(raw || '') ? raw! : '#3B82F6'
}

async function generatePptxFile(kind: GeneratedFileKind, title: string, content: string): Promise<GeneratedBinaryFile> {
  const spec = normalizePresentationSpec(title, content)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'EasyPlus'
  pptx.company = 'EasyPlus'
  pptx.subject = spec.title
  pptx.title = spec.title
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  } as any

  const accent = pickAccentColor(spec)
  const titleSlide = pptx.addSlide()
  titleSlide.background = { color: '0B1020' }
  titleSlide.addText(spec.title, {
    x: 0.6,
    y: 0.8,
    w: 11.4,
    h: 0.8,
    fontFace: 'Aptos Display',
    fontSize: 24,
    bold: true,
    color: 'FFFFFF',
    align: 'left',
  })
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0.6,
    y: 1.8,
    w: 1.6,
    h: 0.08,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  })
  titleSlide.addText(spec.subtitle || 'Prepared in EasyPlus', {
    x: 0.6,
    y: 2.1,
    w: 10.4,
    h: 0.6,
    fontFace: 'Aptos',
    fontSize: 12,
    color: 'D1D5DB',
  })

  spec.slides.forEach((slideSpec, index) => {
    const slide = pptx.addSlide()
    slide.background = { color: index % 2 === 0 ? 'F8FAFC' : 'EEF2FF' }
    slide.addText(slideSpec.title, {
      x: 0.55,
      y: 0.45,
      w: 10.8,
      h: 0.55,
      fontFace: 'Aptos Display',
      fontSize: 20,
      bold: true,
      color: '111827',
    })
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.55,
      y: 1.15,
      w: 11.2,
      h: 5.2,
      rectRadius: 0.08,
      line: { color: 'CBD5E1', transparency: 0, pt: 1 },
      fill: { color: 'FFFFFF' },
      shadow: { type: 'outer', color: '94A3B8', angle: 45, blur: 2, distance: 1, opacity: 0.12 },
    } as any)

    const bulletText = slideSpec.bullets.length > 0
      ? slideSpec.bullets.map(item => ({ text: item, options: { bullet: { indent: 14 } } }))
      : [{ text: 'Summary point', options: { bullet: { indent: 14 } } }]

    slide.addText(bulletText as any, {
      x: 0.9,
      y: 1.55,
      w: 7.0,
      h: 4.2,
      fontFace: 'Aptos',
      fontSize: 16,
      color: '1F2937',
      breakLine: false,
      paraSpaceAfter: 12,
      valign: 'top',
    })

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 8.35,
      y: 1.55,
      w: 2.9,
      h: 3.65,
      rectRadius: 0.08,
      line: { color: accent, transparency: 100 },
      fill: { color: accent, transparency: 10 },
    } as any)
    slide.addText(`Slide ${index + 1}`, {
      x: 8.65,
      y: 1.9,
      w: 2.2,
      h: 0.3,
      fontFace: 'Aptos',
      fontSize: 10,
      bold: true,
      color: accent.replace('#', ''),
      align: 'center',
    })
    slide.addText(slideSpec.speakerNotes || 'Presenter notes available in the slide deck.', {
      x: 8.65,
      y: 2.35,
      w: 2.2,
      h: 2.2,
      fontFace: 'Aptos',
      fontSize: 11,
      color: '334155',
      margin: 0,
      valign: 'mid' as any,
      align: 'center',
    })
    if (slideSpec.speakerNotes) {
      slide.addNotes(slideSpec.speakerNotes)
    }
  })

  const buffer = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as ArrayBuffer)
  const validation = await validateGeneratedBinary(buffer, kind, spec.slides.length, undefined)

  return {
    buffer,
    extension: getGeneratedFileExtension(kind),
    filename: createGeneratedFilename(spec.title, kind),
    kind,
    label: getGeneratedFileLabel(kind),
    mimeType: getGeneratedFileMimeType(kind),
    previewText: buildPresentationPreviewText(spec),
    byteSize: buffer.byteLength,
    validation,
  }
}

function createDocParagraph(
  text: string,
  headingLevel?: (typeof HeadingLevel)[keyof typeof HeadingLevel]
): Paragraph {
  return new Paragraph({
    heading: headingLevel,
    spacing: { after: 160 },
    children: [new TextRun({ text, bold: !!headingLevel })],
  })
}

async function generateDocxFile(kind: GeneratedFileKind, title: string, content: string): Promise<GeneratedBinaryFile> {
  const spec = normalizeDocumentSpec(title, content)
  const children: Array<Paragraph | Table> = [
    createDocParagraph(spec.title, HeadingLevel.TITLE),
  ]

  if (spec.subtitle) {
    children.push(new Paragraph({
      spacing: { after: 220 },
      children: [new TextRun({ text: spec.subtitle, italics: true, color: '4B5563' })],
    }))
  }

  spec.sections.forEach((section) => {
    if (section.heading) {
      children.push(createDocParagraph(section.heading, HeadingLevel.HEADING_1))
    }

    section.paragraphs.forEach((paragraph) => {
      children.push(new Paragraph({
        spacing: { after: 160 },
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: paragraph })],
      }))
    })

    section.bullets.forEach((bullet) => {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 100 },
        children: [new TextRun({ text: bullet })],
      }))
    })

    const table = section.table
    if (table && table.headers.length > 0) {
      const headerRow = new TableRow({
        children: table.headers.map((header) =>
          new TableCell({
            width: { size: 100 / table.headers.length, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })],
          })
        ),
      })

      const bodyRows = table.rows.map((row) =>
        new TableRow({
          children: table.headers.map((_, index) =>
            new TableCell({
              width: { size: 100 / table.headers.length, type: WidthType.PERCENTAGE },
              children: [new Paragraph(String(row[index] || ''))],
            })
          ),
        })
      )

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...bodyRows],
      }))
      children.push(new Paragraph({ spacing: { after: 180 } }))
    }
  })

  const doc = new Document({
    sections: [{ children }],
  })

  const buffer = Buffer.from(await Packer.toBuffer(doc))
  const validation = await validateGeneratedBinary(buffer, kind, undefined, spec.sections.length)

  return {
    buffer,
    extension: getGeneratedFileExtension(kind),
    filename: createGeneratedFilename(spec.title, kind),
    kind,
    label: getGeneratedFileLabel(kind),
    mimeType: getGeneratedFileMimeType(kind),
    previewText: buildDocumentPreviewText(spec),
    byteSize: buffer.byteLength,
    validation,
  }
}

function wrapPdfText(text: string, maxChars = 95): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }

  if (current) lines.push(current)
  return lines
}

async function generatePdfFile(kind: GeneratedFileKind, title: string, content: string): Promise<GeneratedBinaryFile> {
  const spec = normalizeDocumentSpec(title, content)
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([612, 792])
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let y = 740
  const addLine = (text: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gapAfter?: number } = {}) => {
    if (y < 72) {
      page = pdfDoc.addPage([612, 792])
      y = 740
    }

    page.drawText(text, {
      x: 56,
      y,
      size: options.size || 11,
      font: options.bold ? boldFont : font,
      color: options.color || rgb(0.12, 0.16, 0.24),
      maxWidth: 500,
    })
    y -= options.gapAfter || 18
  }

  addLine(spec.title, { size: 22, bold: true, gapAfter: 28 })
  if (spec.subtitle) addLine(spec.subtitle, { size: 12, color: rgb(0.35, 0.42, 0.52), gapAfter: 22 })

  spec.sections.forEach((section) => {
    if (section.heading) addLine(section.heading, { size: 15, bold: true, gapAfter: 18 })
    section.paragraphs.forEach((paragraph) => {
      wrapPdfText(paragraph).forEach((line, index, lines) => {
        addLine(line, { gapAfter: index === lines.length - 1 ? 16 : 14 })
      })
    })
    section.bullets.forEach((bullet) => {
      wrapPdfText(`- ${bullet}`, 88).forEach((line, index, lines) => {
        addLine(line, { gapAfter: index === lines.length - 1 ? 14 : 12 })
      })
    })
    if (section.table) {
      addLine(section.table.headers.join(' | '), { bold: true, gapAfter: 14 })
      section.table.rows.forEach((row) => addLine(row.join(' | '), { gapAfter: 14 }))
    }
    y -= 8
  })

  const buffer = Buffer.from(await pdfDoc.save())
  const validation = await validateGeneratedBinary(buffer, kind, undefined, spec.sections.length)

  return {
    buffer,
    extension: getGeneratedFileExtension(kind),
    filename: createGeneratedFilename(spec.title, kind),
    kind,
    label: getGeneratedFileLabel(kind),
    mimeType: getGeneratedFileMimeType(kind),
    previewText: buildDocumentPreviewText(spec),
    byteSize: buffer.byteLength,
    validation,
  }
}

export async function generateBinaryFileFromArtifact(input: {
  kind: string
  title: string
  content: string
}): Promise<GeneratedBinaryFile> {
  const normalizedKind = normalizeGeneratedFileKind(input.kind)
  if (!normalizedKind) {
    throw new Error('This file type is not supported for real downloads yet.')
  }

  const title = String(input.title || '').trim() || 'Generated file'
  const content = String(input.content || '').trim()
  if (!content) {
    if (normalizedKind === 'pptx' || normalizedKind === 'gslides') {
      throw new Error('PowerPoint file could not be generated correctly. Please try again.')
    }
    if (normalizedKind === 'docx' || normalizedKind === 'gdoc') {
      throw new Error('Word document could not be generated correctly. Please try again.')
    }
    throw new Error('PDF file could not be generated correctly. Please try again.')
  }

  if (normalizedKind === 'pptx' || normalizedKind === 'gslides') {
    return generatePptxFile(normalizedKind, title, content)
  }

  if (normalizedKind === 'docx' || normalizedKind === 'gdoc') {
    return generateDocxFile(normalizedKind, title, content)
  }

  return generatePdfFile(normalizedKind, title, content)
}

async function validateGeneratedBinary(
  buffer: Buffer,
  kind: GeneratedFileKind,
  slideCount?: number,
  sectionCount?: number
): Promise<GeneratedBinaryFile['validation']> {
  if (!buffer || buffer.byteLength < 200) {
    return {
      valid: false,
      format: kind === 'pdf' ? 'pdf' : kind === 'pptx' || kind === 'gslides' ? 'pptx' : 'docx',
      entriesChecked: [],
      slideCount,
      sectionCount,
      reason: 'File buffer was unexpectedly small.',
    }
  }

  if (kind === 'pdf') {
    const header = buffer.subarray(0, 4).toString('utf8')
    return {
      valid: header === '%PDF',
      format: 'pdf',
      entriesChecked: ['%PDF'],
      sectionCount,
      reason: header === '%PDF' ? null : 'Missing PDF header.',
    }
  }

  const zipSignature = buffer.subarray(0, 2).toString('utf8')
  if (zipSignature !== 'PK') {
    return {
      valid: false,
      format: kind === 'pptx' || kind === 'gslides' ? 'pptx' : 'docx',
      entriesChecked: ['PK'],
      slideCount,
      sectionCount,
      reason: 'Missing ZIP signature.',
    }
  }

  const zip = await JSZip.loadAsync(buffer)
  const requiredEntries = kind === 'pptx' || kind === 'gslides'
    ? ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']
    : ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']

  const entriesChecked = [...requiredEntries]
  const missing = requiredEntries.filter((entry) => !zip.file(entry))
  if (kind === 'pptx' || kind === 'gslides') {
    const slideEntries = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    entriesChecked.push(...slideEntries.slice(0, 8))
    return {
      valid: missing.length === 0 && slideEntries.length > 0,
      format: 'pptx',
      entriesChecked,
      slideCount: slideEntries.length,
      reason: missing.length === 0 && slideEntries.length > 0 ? null : `Missing PPTX entries: ${missing.join(', ') || 'slide XML'}`,
    }
  }

  return {
    valid: missing.length === 0,
    format: 'docx',
    entriesChecked,
    sectionCount,
    reason: missing.length === 0 ? null : `Missing DOCX entries: ${missing.join(', ')}`,
  }
}
