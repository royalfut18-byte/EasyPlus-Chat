'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Download, Code, Eye, GripVertical, Package, AlertTriangle, Blocks, EyeOff, Monitor, Tablet, Smartphone, RefreshCw } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Artifact } from '@/types/models'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface ArtifactPanelProps {
  artifact: Artifact | null
  isOpen: boolean
  onClose: () => void
  width?: number
  onWidthChange?: (width: number) => void
}

const MIN_WIDTH = 380
const MAX_WIDTH_PERCENT = 0.75
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function createCrc32Table(): number[] {
  const table: number[] = []
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let j = 0; j < 8; j++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
}

const CRC32_TABLE = createCrc32Table()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff)
}

function writeUint32(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function pushBytes(output: number[], bytes: Uint8Array) {
  for (const byte of bytes) {
    output.push(byte)
  }
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function createZip(files: Array<{ name: string; content: string }>, mimeType: string): Blob {
  const output: number[] = []
  const centralDirectory: number[] = []

  for (const file of files) {
    const nameBytes = encodeText(file.name)
    const contentBytes = encodeText(file.content)
    const checksum = crc32(contentBytes)
    const localHeaderOffset = output.length

    writeUint32(output, 0x04034b50)
    writeUint16(output, 20)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint32(output, checksum)
    writeUint32(output, contentBytes.length)
    writeUint32(output, contentBytes.length)
    writeUint16(output, nameBytes.length)
    writeUint16(output, 0)
    pushBytes(output, nameBytes)
    pushBytes(output, contentBytes)

    writeUint32(centralDirectory, 0x02014b50)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, checksum)
    writeUint32(centralDirectory, contentBytes.length)
    writeUint32(centralDirectory, contentBytes.length)
    writeUint16(centralDirectory, nameBytes.length)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, 0)
    writeUint32(centralDirectory, localHeaderOffset)
    pushBytes(centralDirectory, nameBytes)
  }

  const centralDirectoryOffset = output.length
  output.push(...centralDirectory)

  writeUint32(output, 0x06054b50)
  writeUint16(output, 0)
  writeUint16(output, 0)
  writeUint16(output, files.length)
  writeUint16(output, files.length)
  writeUint32(output, centralDirectory.length)
  writeUint32(output, centralDirectoryOffset)
  writeUint16(output, 0)

  return new Blob([new Uint8Array(output)], { type: mimeType })
}

function textRunXml(text: string, options: { bold?: boolean; italic?: boolean } = {}): string {
  if (!text) return ''

  const runProperties = [
    options.bold ? '<w:b/>' : '',
    options.italic ? '<w:i/>' : '',
  ].join('')

  return `<w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

function inlineRunsXml(text: string, baseOptions: { bold?: boolean; italic?: boolean } = {}): string {
  const runs: string[] = []
  let buffer = ''
  let index = 0

  const flush = () => {
    if (buffer) {
      runs.push(textRunXml(buffer, baseOptions))
      buffer = ''
    }
  }

  while (index < text.length) {
    const marker = text.startsWith('**', index) ? '**' : text.startsWith('__', index) ? '__' : null
    if (marker) {
      const end = text.indexOf(marker, index + marker.length)
      if (end !== -1) {
        flush()
        runs.push(textRunXml(text.slice(index + marker.length, end), { ...baseOptions, bold: true }))
        index = end + marker.length
        continue
      }
    }

    const char = text[index]
    if ((char === '*' || char === '_') && text[index + 1] !== char) {
      const end = text.indexOf(char, index + 1)
      if (end !== -1) {
        flush()
        runs.push(textRunXml(text.slice(index + 1, end), { ...baseOptions, italic: true }))
        index = end + 1
        continue
      }
    }

    buffer += char
    index += 1
  }

  flush()
  return runs.join('') || textRunXml(text, baseOptions)
}

function paragraphXml(line: string): string {
  const trimmed = line.trim()
  const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
  const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
  const text = headingMatch?.[2] || bulletMatch?.[1] || trimmed
  const size = headingMatch
    ? headingMatch[1].length === 1 ? '<w:sz w:val="32"/>' : '<w:sz w:val="28"/>'
    : ''
  const prefix = bulletMatch ? '- ' : ''

  if (headingMatch) {
    return `<w:p><w:r><w:rPr><w:b/>${size}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  }

  return `<w:p>${inlineRunsXml(prefix + text)}</w:p>`
}

function markdownTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = markdownTableCells(line)
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function isMarkdownTableRow(line: string): boolean {
  return line.includes('|') && markdownTableCells(line).length > 1
}

function tableXml(rows: string[][]): string {
  const border = '<w:top w:val="single" w:sz="4" w:space="0" w:color="bfbfbf"/><w:left w:val="single" w:sz="4" w:space="0" w:color="bfbfbf"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="bfbfbf"/><w:right w:val="single" w:sz="4" w:space="0" w:color="bfbfbf"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="bfbfbf"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="bfbfbf"/>'
  const maxColumns = Math.max(...rows.map(row => row.length), 1)

  const tableRows = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: maxColumns }, (_, cellIndex) => row[cellIndex] || '')
    const tableCells = cells.map(cell => {
      const shading = rowIndex === 0 ? '<w:shd w:fill="EDEDED"/>' : ''
      return `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / maxColumns)}" w:type="dxa"/>${shading}</w:tcPr><w:p>${inlineRunsXml(cell, { bold: rowIndex === 0 })}</w:p></w:tc>`
    }).join('')

    return `<w:tr>${tableCells}</w:tr>`
  }).join('')

  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>${tableRows}</w:tbl>`
}

function documentBodyXml(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (
      isMarkdownTableRow(line) &&
      index + 1 < lines.length &&
      isMarkdownTableSeparator(lines[index + 1])
    ) {
      const rows = [markdownTableCells(line)]
      index += 2

      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        rows.push(markdownTableCells(lines[index]))
        index += 1
      }

      blocks.push(tableXml(rows))
      continue
    }

    blocks.push(line.trim() ? paragraphXml(line) : '<w:p/>')
    index += 1
  }

  return blocks.join('')
}

function parseDelimitedRows(content: string): string[][] {
  const trimmed = content.trim()
  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const tableLines = lines.filter(line => line.includes('|'))

  if (tableLines.length >= 2) {
    return tableLines
      .filter(line => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
      .map(line => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()))
      .filter(row => row.length > 0)
  }

  return lines.map(line => {
    const delimiter = line.includes('\t') ? '\t' : ','
    return line.split(delimiter).map(cell => cell.trim())
  })
}

function columnName(index: number): string {
  let name = ''
  let current = index + 1
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

function createXlsxBlob(title: string, content: string): Blob {
  const rows = parseDelimitedRows(content)
  const safeRows = rows.length > 0 ? rows : [[title], [content]]
  const sheetData = safeRows.map((row, rowIndex) => {
    const cells = row.map((cell, cellIndex) => {
      const ref = `${columnName(cellIndex)}${rowIndex + 1}`
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')

  return createZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(title.substring(0, 31) || 'Sheet1')}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetData}</sheetData>
</worksheet>`,
    },
  ], XLSX_MIME_TYPE)
}

function slideXml(title: string, body: string): string {
  const bodyText = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="685800" y="1600200"/><a:ext cx="7772400" cy="4267200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${escapeXml(bodyText)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
}

function parseSlides(title: string, content: string): Array<{ title: string; body: string }> {
  const parts = content.split(/\n\s*---\s*\n/g).map(part => part.trim()).filter(Boolean)
  const slides = parts.length > 0 ? parts : [content]

  return slides.map((part, index) => {
    const lines = part.split(/\r?\n/)
    const first = lines.find(line => line.trim()) || `${title} ${index + 1}`
    const heading = first.replace(/^#+\s*/, '').trim()
    const body = lines.slice(lines.indexOf(first) + 1).join('\n').trim() || part
    return {
      title: heading || `${title} ${index + 1}`,
      body,
    }
  })
}

function createPptxBlob(title: string, content: string): Blob {
  const slides = parseSlides(title, content)
  const slideOverrides = slides.map((_, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join('')
  const slideIds = slides.map((_, index) =>
    `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`
  ).join('')
  const slideRelationships = slides.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
  ).join('')

  return createZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slideOverrides}
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    },
    {
      name: 'ppt/presentation.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slideRelationships}
</Relationships>`,
    },
    ...slides.map((slide, index) => ({
      name: `ppt/slides/slide${index + 1}.xml`,
      content: slideXml(slide.title, slide.body),
    })),
  ], PPTX_MIME_TYPE)
}

function createCanvaHtml(title: string, content: string): string {
  const trimmed = content.trim()
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) return trimmed

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeXml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; font-family: Arial, sans-serif; background: #111827; color: white; display: grid; place-items: center; }
    main { width: min(900px, calc(100vw - 48px)); background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 24px; padding: 48px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    h1 { font-size: clamp(36px, 6vw, 72px); margin: 0 0 24px; }
    pre { white-space: pre-wrap; font: inherit; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeXml(title)}</h1>
    <pre>${escapeXml(content)}</pre>
  </main>
</body>
</html>`
}

function createDocxBlob(title: string, content: string): Blob {
  const body = documentBodyXml(content)

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphXml(`# ${title}`)}
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`

  return createZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      content: documentXml,
    },
  ], DOCX_MIME_TYPE)
}

export function ArtifactPanel({ artifact, isOpen, onClose, width = 560, onWidthChange }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview')
  const [isResizing, setIsResizing] = useState(false)
  const [currentWidth, setCurrentWidth] = useState(width)
  const [isMobile, setIsMobile] = useState(false)
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [refreshKey, setRefreshKey] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    setCurrentWidth(width)
  }, [width])

  useEffect(() => {
    if (!isResizing) return

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault()

      // Calculate new width: distance from pointer to right edge of window
      const newWidth = window.innerWidth - e.clientX

      // Clamp width
      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth))

      setCurrentWidth(clampedWidth)
    }

    const handlePointerUp = (e: PointerEvent) => {
      e.preventDefault()
      setIsResizing(false)

      // Restore user select
      document.body.style.userSelect = ''
      document.body.style.cursor = ''

      // Save to localStorage and notify parent
      if (typeof window !== 'undefined') {
        localStorage.setItem('easyplus-artifact-panel-width', currentWidth.toString())
      }
      onWidthChange?.(currentWidth)
    }

    // Add listeners to document for smooth dragging
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)

    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isResizing, currentWidth, onWidthChange])

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    setIsResizing(true)

    // Prevent text selection during resize
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  // Debug logging
  if (process.env.NODE_ENV !== 'production' && isOpen) {
    console.log('[ArtifactPanel] Rendering', {
      hasArtifact: !!artifact,
      title: artifact?.title,
      language: artifact?.language,
      codeLength: artifact?.code?.length,
    })
  }

  const canPreview = artifact?.language === 'html' || artifact?.language === 'canva'
  const isReact = artifact?.language === 'tsx' || artifact?.language === 'jsx'
  const currentTab = canPreview || isReact ? activeTab : 'code'

  // Get display label for artifact language
  const getLanguageLabel = (artifact: Artifact | null): string => {
    if (!artifact) return 'No artifact'

    const lang = artifact.language
    const code = artifact.code || ''

    // HTML artifacts with inline CSS/JS
    if (lang === 'html') {
      const hasCSS = code.includes('<style')
      const hasJS = code.includes('<script')

      if (hasCSS && hasJS) return 'HTML + CSS + JS'
      if (hasCSS) return 'HTML + CSS'
      if (hasJS) return 'HTML + JS'
      return 'HTML'
    }

    // React artifacts
    if (lang === 'tsx') return 'React / TSX'
    if (lang === 'jsx') return 'React / JSX'

    // Other languages
    if (lang === 'javascript') return 'JavaScript'
    if (lang === 'python') return 'Python'
    if (lang === 'css') return 'CSS'
    if (lang === 'markdown') return 'Markdown'
    if (lang === 'docx') return 'Microsoft Word'
    if (lang === 'gdoc') return 'Google Docs'
    if (lang === 'xlsx') return 'Excel'
    if (lang === 'gsheet') return 'Google Sheets'
    if (lang === 'pptx') return 'PowerPoint'
    if (lang === 'gslides') return 'Google Slides'
    if (lang === 'canva') return 'Canva-style HTML'

    return lang.toUpperCase()
  }

  const renderPanelContent = () => (
    <div className="flex flex-col h-full" style={{ paddingLeft: isMobile ? 0 : '12px' }}>
      {/* Dev Debug Info */}
      {process.env.NODE_ENV !== 'production' && (
        <div className="bg-yellow-500/20 border-b border-yellow-500/50 p-2 text-xs text-yellow-300">
          Debug: Artifact loaded: {artifact ? 'YES' : 'NO'} | Language: {artifact?.language || 'N/A'} | Code length: {artifact?.code?.length || 0}
        </div>
      )}

      {/* Header */}
      <div className="bg-white/[0.02] border-b border-white/[0.06] p-4 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-white truncate">
            {artifact?.title || 'No Artifact'}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {artifact ? `${getLanguageLabel(artifact)} • Artifact` : 'No artifact selected'}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="ml-3 shrink-0 hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Tabs and Controls */}
      <div className="bg-white/[0.02] border-b border-white/[0.06] px-4 flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          {canPreview && (
            <button
              onClick={() => setActiveTab('preview')}
              className={cn(
                'px-4 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2',
                currentTab === 'preview'
                  ? 'text-white border-violet-500'
                  : 'text-gray-400 border-transparent hover:text-white'
              )}
            >
              <Eye className="h-4 w-4" />
              Preview
            </button>
          )}
          <button
            onClick={() => setActiveTab('code')}
            className={cn(
              'px-4 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2',
              currentTab === 'code'
                ? 'text-white border-violet-500'
                : 'text-gray-400 border-transparent hover:text-white'
            )}
          >
            <Code className="h-4 w-4" />
            Code
          </button>
        </div>

        {/* Device Preview Controls - Only show in preview tab for HTML */}
        {canPreview && currentTab === 'preview' && artifact?.code && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPreviewDevice('desktop')}
              title="Desktop view"
              className={cn(
                'p-2 rounded transition-colors',
                previewDevice === 'desktop'
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Monitor className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPreviewDevice('tablet')}
              title="Tablet view"
              className={cn(
                'p-2 rounded transition-colors',
                previewDevice === 'tablet'
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Tablet className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPreviewDevice('mobile')}
              title="Mobile view"
              className={cn(
                'p-2 rounded transition-colors',
                previewDevice === 'mobile'
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Smartphone className="h-4 w-4" />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              title="Refresh preview"
              className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#08070d]">
        {!artifact ? (
          <div className="flex items-center justify-center h-full p-8 text-center">
            <div className="max-w-md space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-gray-400 mx-auto">
                <Package className="h-8 w-8" />
              </div>
              <h4 className="text-lg font-semibold text-white">No Artifact Selected</h4>
              <p className="text-sm text-gray-400">
                Create or select an artifact to view it here.
              </p>
            </div>
          </div>
        ) : !artifact.code ? (
          <div className="flex items-center justify-center h-full p-8 text-center">
            <div className="max-w-md space-y-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-500/30 bg-orange-500/10 text-orange-400 mx-auto">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <h4 className="text-lg font-semibold text-white">Empty Artifact</h4>
              <p className="text-sm text-gray-400">
                This artifact has no code to display.
              </p>
            </div>
          </div>
        ) : currentTab === 'preview' ? (
          canPreview ? (
            <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col items-center justify-center p-4">
              {/* Interactive hint for games/apps */}
              <div className="text-center mb-2">
                <p className="text-xs text-gray-400">
                  Click inside preview to interact • Press keys for controls
                </p>
              </div>
              <div
                className="bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-200 transition-all duration-300 cursor-pointer"
                style={{
                  width: previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%',
                  maxWidth: '100%',
                  height: previewDevice === 'desktop' ? 'calc(100% - 28px)' : 'auto',
                  maxHeight: previewDevice === 'desktop' ? '100%' : 'calc(100% - 28px)',
                }}
                onClick={() => iframeRef.current?.focus()}
              >
                <iframe
                  ref={iframeRef}
                  key={refreshKey}
                  srcDoc={artifact.language === 'canva' ? createCanvaHtml(artifact.title, artifact.code) : artifact.code}
                  title={artifact.title}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
                  className="w-full h-full border-0 bg-white pointer-events-auto"
                  style={{
                    minHeight: previewDevice !== 'desktop' ? '600px' : undefined,
                  }}
                  tabIndex={0}
                  onLoad={() => {
                    // Auto-focus iframe after load for keyboard controls
                    setTimeout(() => iframeRef.current?.focus(), 100)
                  }}
                />
              </div>
            </div>
          ) : isReact ? (
            <div className="flex items-center justify-center h-full p-8 text-center">
              <div className="max-w-md space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mx-auto">
                  <Blocks className="h-8 w-8" />
                </div>
                <h4 className="text-lg font-semibold text-white">React Component</h4>
                <p className="text-sm text-gray-400">
                  Live preview is not available for React components yet. Use the Code tab to view and copy the component code.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full p-8 text-center">
              <div className="max-w-md space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-gray-400 mx-auto">
                  <EyeOff className="h-8 w-8" />
                </div>
                <h4 className="text-lg font-semibold text-white">Preview Not Available</h4>
                <p className="text-sm text-gray-400">
                  Preview is only available for HTML and Canva-style artifacts. Switch to the Code tab to view the {artifact.language} content.
                </p>
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 overflow-auto p-4 min-h-0">
            <SyntaxHighlighter
              language={
                artifact.language === 'tsx' || artifact.language === 'jsx'
                  ? 'tsx'
                  : artifact.language === 'javascript'
                    ? 'javascript'
                    : ['docx', 'gdoc', 'xlsx', 'gsheet', 'pptx', 'gslides'].includes(artifact.language)
                      ? 'text'
                      : artifact.language === 'canva'
                        ? 'html'
                      : artifact.language
              }
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                background: 'rgba(17, 17, 24, 0.6)',
              }}
              showLineNumbers
              wrapLines
            >
              {artifact.code}
            </SyntaxHighlighter>
          </div>
        )}
      </div>

      {/* Actions */}
      {artifact && artifact.code && (
        <div className="bg-white/[0.02] border-t border-white/[0.06] p-4 flex gap-3">
          <Button
            onClick={handleCopy}
            className="flex-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1]"
            variant="ghost"
          >
            <Copy className="h-4 w-4 mr-2" />
            {['docx', 'gdoc', 'xlsx', 'gsheet', 'pptx', 'gslides'].includes(artifact.language) ? 'Copy Content' : 'Copy Code'}
          </Button>
          <Button
            onClick={handleDownload}
            className="flex-1 bg-violet-600/80 hover:bg-violet-600 text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </div>
      )}
    </div>
  )

  const handleCopy = () => {
    if (!artifact?.code) return
    navigator.clipboard.writeText(artifact.code)
    toast({
      title: 'Copied to clipboard',
      description: 'Artifact code copied successfully',
    })
  }

  const handleDownload = () => {
    if (!artifact?.code) return

    const extensions: Record<string, string> = {
      html: 'html',
      tsx: 'tsx',
      jsx: 'jsx',
      javascript: 'js',
      css: 'css',
      python: 'py',
      markdown: 'md',
      text: 'txt',
      docx: 'docx',
      gdoc: 'docx',
      xlsx: 'xlsx',
      gsheet: 'xlsx',
      pptx: 'pptx',
      gslides: 'pptx',
      canva: 'html',
    }

    const extension = extensions[artifact.language] || 'txt'
    const filename = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${extension}`

    const blob = artifact.language === 'docx' || artifact.language === 'gdoc'
      ? createDocxBlob(artifact.title, artifact.code)
      : artifact.language === 'xlsx' || artifact.language === 'gsheet'
        ? createXlsxBlob(artifact.title, artifact.code)
        : artifact.language === 'pptx' || artifact.language === 'gslides'
          ? createPptxBlob(artifact.title, artifact.code)
          : artifact.language === 'canva'
            ? new Blob([createCanvaHtml(artifact.title, artifact.code)], { type: 'text/html' })
            : new Blob([artifact.code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: 'Downloaded',
      description: `Artifact saved as ${filename}`,
    })
  }

  return (
    <>
      {/* Mobile: Fixed overlay full-screen */}
      {isMobile && isOpen && (
        <AnimatePresence>
          <motion.div
            ref={panelRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-0 z-50 bg-[#08070d] md:hidden"
          >
            {renderPanelContent()}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Desktop: Flex child */}
      {!isMobile && isOpen && (
        <aside
          ref={panelRef}
          className="hidden md:flex relative h-full min-h-0 flex-shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a10] shadow-2xl"
          style={{ width: `${currentWidth}px` }}
        >
          {/* Resize Handle - Desktop Only - Full Height */}
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group',
              'hover:bg-violet-500/5 transition-colors',
              isResizing && 'bg-violet-500/10'
            )}
            style={{
              zIndex: 100,
              pointerEvents: 'auto',
            }}
            onPointerDown={handleResizeStart}
          >
            {/* Vertical line spanning full height */}
            <div className={cn(
              'absolute left-1 w-px h-full bg-white/10 transition-colors',
              'group-hover:bg-violet-400/40',
              isResizing && 'bg-violet-400/60'
            )} />
            {/* Centered grip indicator */}
            <div className={cn(
              'absolute top-1/2 left-0.5 -translate-y-1/2 w-1.5 h-16 rounded-full bg-violet-400/40 transition-opacity',
              'opacity-0 group-hover:opacity-100',
              isResizing && 'opacity-100'
            )} />
          </div>

          {renderPanelContent()}
        </aside>
      )}
    </>
  )
}
