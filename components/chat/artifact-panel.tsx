'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Download, Code, Eye, Package, AlertTriangle, Blocks, EyeOff, Monitor, Tablet, Smartphone, RefreshCw, Maximize2, Minimize2, Loader2 } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Artifact } from '@/types/models'
import { toast } from '@/components/ui/use-toast'
import { getGeneratedFileExtension, getGeneratedFileLabel, isGeneratedFileArtifactLanguage } from '@/lib/generated-files'
import { decodePossiblyEscapedText, type GeneratedZipFile } from '@/lib/generated-zip'
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
const PREVIEWABLE_LANGUAGES = new Set([
  'html',
  'canva',
  'markdown',
  'json',
  'svg',
  'css',
  'javascript',
  'text',
  'docx',
  'gdoc',
  'xlsx',
  'gsheet',
  'pptx',
  'gslides',
  'pdf',
])

type ArtifactWithZipPreview = Artifact & {
  zipPreviewFiles?: GeneratedZipFile[]
  zipPreviewPath?: string
}

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

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '"') {
      const next = line[index + 1]
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function normalizeSpreadsheetPreviewSpec(title: string, content: string): {
  title: string
  headers: string[]
  rows: string[][]
} | null {
  const parsed = parsePreviewJson(content)
  if (!parsed) return null

  const headersSource = Array.isArray(parsed.headers)
    ? parsed.headers
    : Array.isArray(parsed.columns)
      ? parsed.columns
      : null

  const rowsSource = Array.isArray(parsed.rows)
    ? parsed.rows
    : null

  const firstSheet = Array.isArray(parsed.sheets) && parsed.sheets.length > 0 && parsed.sheets[0] && typeof parsed.sheets[0] === 'object'
    ? parsed.sheets[0] as Record<string, any>
    : null

  const headers = headersSource
    ? headersSource.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : Array.isArray(firstSheet?.headers)
      ? firstSheet.headers.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : Array.isArray(firstSheet?.columns)
        ? firstSheet.columns.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : []

  const rowSource = rowsSource
    || (Array.isArray(firstSheet?.rows) ? firstSheet.rows : null)

  const rows = (rowSource || [])
    .map((row: unknown) => Array.isArray(row) ? row.map((item) => String(item || '').trim()) : [])
    .filter((row: string[]) => row.length > 0)

  if (!headers.length && !rows.length) return null

  return {
    title: String(parsed.title || firstSheet?.name || title || 'Sheet').trim() || 'Sheet',
    headers,
    rows,
  }
}

function parseDelimitedRows(content: string): string[][] {
  const spreadsheetSpec = normalizeSpreadsheetPreviewSpec('', content)
  if (spreadsheetSpec) {
    const normalizedRows = spreadsheetSpec.rows.map((row) => {
      if (spreadsheetSpec.headers.length === 0) return row
      return Array.from({ length: spreadsheetSpec.headers.length }, (_, index) => row[index] || '')
    })

    return spreadsheetSpec.headers.length > 0
      ? [spreadsheetSpec.headers, ...normalizedRows]
      : normalizedRows
  }

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
    return parseDelimitedLine(line, delimiter)
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

const PREVIEW_EVENT_TYPE = 'easyplus-artifact-preview'

const PREVIEW_BRIDGE_SCRIPT = `
<script data-easyplus-preview-bridge>
(function () {
  function report(kind, detail) {
    try {
      parent.postMessage({ type: '${PREVIEW_EVENT_TYPE}', kind: kind, detail: detail || null }, '*');
    } catch (error) {
      // Ignore cross-origin reporting failures inside sandboxed previews.
    }
  }

  window.addEventListener('error', function (event) {
    report('error', {
      message: event && event.message ? String(event.message) : 'Unknown runtime error',
      source: event && event.filename ? String(event.filename) : null,
      line: event && typeof event.lineno === 'number' ? event.lineno : null,
      column: event && typeof event.colno === 'number' ? event.colno : null
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    report('error', {
      message: reason && reason.message ? String(reason.message) : String(reason || 'Unhandled promise rejection')
    });
  });

  var signalReady = function () { report('ready', null); };
  document.addEventListener('DOMContentLoaded', signalReady, { once: true });
  window.addEventListener('load', signalReady, { once: true });
})();
</script>`

function injectPreviewBridge(html: string): string {
  if (html.includes('data-easyplus-preview-bridge')) return html
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${PREVIEW_BRIDGE_SCRIPT}</head>`)
  }
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${PREVIEW_BRIDGE_SCRIPT}</body>`)
  }
  if (/<\/html\s*>/i.test(html)) {
    return html.replace(/<\/html\s*>/i, `${PREVIEW_BRIDGE_SCRIPT}</html>`)
  }
  return `${html}\n${PREVIEW_BRIDGE_SCRIPT}`
}

function createPreviewHtml(title: string, content: string): string {
  const normalizedContent = decodePossiblyEscapedText(content)
  const trimmed = normalizedContent.trim()
  const html = /^<!DOCTYPE\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)
    ? trimmed
    : `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeXml(title)}</title>
</head>
<body>
${normalizedContent}
</body>
</html>`

  return injectPreviewBridge(html)
}

function createCanvaHtml(title: string, content: string): string {
  const trimmed = content.trim()
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) return createPreviewHtml(title, trimmed)

  return createPreviewHtml(title, `<!DOCTYPE html>
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
</html>`)
}

function parsePreviewJson(content: string): Record<string, any> | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null

  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null
  } catch {
    return null
  }
}

function toPreviewParagraphs(value: unknown): string[] {
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

function toPreviewBullets(value: unknown): string[] {
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

function normalizeDocumentPreviewSpec(title: string, content: string): {
  title: string
  subtitle?: string
  sections: Array<{
    heading?: string
    paragraphs: string[]
    bullets: string[]
    table?: {
      headers: string[]
      rows: string[][]
    }
  }>
} | null {
  const parsed = parsePreviewJson(content)
  if (!parsed || !Array.isArray(parsed.sections)) return null

  const sections = parsed.sections
    .map((section) => {
      const record = section && typeof section === 'object' && !Array.isArray(section)
        ? section as Record<string, any>
        : {}

      const rawTable = record.table && typeof record.table === 'object' && !Array.isArray(record.table)
        ? record.table as Record<string, any>
        : null

      const table = rawTable && Array.isArray(rawTable.headers) && Array.isArray(rawTable.rows)
        ? {
            headers: rawTable.headers.map((item: unknown) => String(item || '').trim()).filter(Boolean),
            rows: rawTable.rows
              .map((row: unknown) => Array.isArray(row) ? row.map((item) => String(item || '').trim()) : [])
              .filter((row: string[]) => row.length > 0),
          }
        : undefined

      return {
        heading: String(record.heading || record.title || '').trim() || undefined,
        paragraphs: toPreviewParagraphs(record.paragraphs || record.content),
        bullets: toPreviewBullets(record.bullets),
        table,
      }
    })
    .filter((section) => section.heading || section.paragraphs.length > 0 || section.bullets.length > 0 || section.table)

  if (!sections.length) return null

  return {
    title: String(parsed.title || title || 'Document').trim() || 'Document',
    subtitle: String(parsed.subtitle || '').trim() || undefined,
    sections,
  }
}

function normalizePresentationPreviewSpec(title: string, content: string): {
  title: string
  subtitle?: string
  slides: Array<{
    title: string
    bullets: string[]
  }>
} | null {
  const parsed = parsePreviewJson(content)
  if (!parsed || !Array.isArray(parsed.slides)) return null

  const slides = parsed.slides
    .map((slide, index) => {
      const record = slide && typeof slide === 'object' && !Array.isArray(slide)
        ? slide as Record<string, any>
        : {}

      const bullets = [
        ...toPreviewBullets(record.bullets),
        ...toPreviewParagraphs(record.paragraphs),
      ].filter(Boolean)

      return {
        title: String(record.title || '').trim() || `Slide ${index + 1}`,
        bullets,
      }
    })
    .filter((slide) => slide.title || slide.bullets.length > 0)

  if (!slides.length) return null

  return {
    title: String(parsed.title || title || 'Presentation').trim() || 'Presentation',
    subtitle: String(parsed.subtitle || '').trim() || undefined,
    slides,
  }
}

function renderMarkdownTableHtml(lines: string[]): string {
  const rows = lines
    .filter(line => !isMarkdownTableSeparator(line))
    .map(markdownTableCells)
    .filter(row => row.length > 0)

  if (!rows.length) return ''

  const columnCount = Math.max(...rows.map(row => row.length), 1)
  const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] || ''))
  const [headerRow, ...bodyRows] = normalizedRows
  const headerHtml = `<thead><tr>${headerRow.map((cell) => `<th>${escapeXml(cell)}</th>`).join('')}</tr></thead>`
  const bodyHtml = bodyRows.length > 0
    ? `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeXml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : ''

  return `<div class="doc-table-wrap"><table class="doc-table">${headerHtml}${bodyHtml}</table></div>`
}

function renderMarkdownPreviewBlocks(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (
      isMarkdownTableRow(line) &&
      index + 1 < lines.length &&
      isMarkdownTableSeparator(lines[index + 1])
    ) {
      const tableLines = [line]
      index += 1

      while (index < lines.length && (isMarkdownTableRow(lines[index]) || isMarkdownTableSeparator(lines[index]))) {
        tableLines.push(lines[index])
        index += 1
      }

      blocks.push(renderMarkdownTableHtml(tableLines))
      continue
    }

    if (/^###\s+/.test(trimmed)) {
      blocks.push(`<h3>${escapeXml(trimmed.replace(/^###\s+/, ''))}</h3>`)
      index += 1
      continue
    }

    if (/^##\s+/.test(trimmed)) {
      blocks.push(`<h2>${escapeXml(trimmed.replace(/^##\s+/, ''))}</h2>`)
      index += 1
      continue
    }

    if (/^#\s+/.test(trimmed)) {
      blocks.push(`<h1>${escapeXml(trimmed.replace(/^#\s+/, ''))}</h1>`)
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(`<li>${escapeXml(lines[index].trim().replace(/^[-*]\s+/, ''))}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    const paragraphLines = [trimmed]
    index += 1
    while (index < lines.length) {
      const candidate = lines[index].trim()
      if (
        !candidate ||
        /^#{1,3}\s+/.test(candidate) ||
        /^[-*]\s+/.test(candidate) ||
        (
          isMarkdownTableRow(lines[index]) &&
          index + 1 < lines.length &&
          isMarkdownTableSeparator(lines[index + 1])
        )
      ) {
        break
      }

      paragraphLines.push(candidate)
      index += 1
    }

    blocks.push(`<p>${escapeXml(paragraphLines.join('\n')).replace(/\n/g, '<br />')}</p>`)
  }

  return blocks.join('\n')
}

function createMarkdownPreviewHtml(title: string, content: string): string {
  const documentSpec = normalizeDocumentPreviewSpec(title, content)
  if (documentSpec) {
    const sectionsHtml = documentSpec.sections.map((section) => {
      const paragraphs = section.paragraphs
        .map((paragraph) => `<p>${escapeXml(paragraph).replace(/\n/g, '<br />')}</p>`)
        .join('')
      const bullets = section.bullets.length > 0
        ? `<ul>${section.bullets.map((bullet) => `<li>${escapeXml(bullet)}</li>`).join('')}</ul>`
        : ''
      const tableSpec = section.table
      const table = tableSpec && tableSpec.headers.length > 0
        ? `<div class="doc-table-wrap"><table class="doc-table"><thead><tr>${tableSpec.headers.map((header) => `<th>${escapeXml(header)}</th>`).join('')}</tr></thead><tbody>${tableSpec.rows.map((row) => `<tr>${tableSpec.headers.map((_, index) => `<td>${escapeXml(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : ''

      return `<section class="doc-section">
        ${section.heading ? `<h2>${escapeXml(section.heading)}</h2>` : ''}
        ${paragraphs}
        ${bullets}
        ${table}
      </section>`
    }).join('')

    return createPreviewHtml(documentSpec.title, `<main class="document-preview">
      <header class="document-hero">
        <span class="document-kicker">Document Artifact</span>
        <h1>${escapeXml(documentSpec.title)}</h1>
        ${documentSpec.subtitle ? `<p>${escapeXml(documentSpec.subtitle)}</p>` : ''}
      </header>
      ${sectionsHtml}
    </main><style>
      body { margin: 0; background: #f3efe7; color: #1f2937; font-family: Georgia, 'Times New Roman', serif; }
      .document-preview { max-width: 960px; margin: 0 auto; padding: 36px 20px 72px; }
      .document-hero, .doc-section { background: rgba(255,255,255,.92); border: 1px solid rgba(148,163,184,.24); box-shadow: 0 18px 40px rgba(15,23,42,.08); }
      .document-hero { padding: 36px; border-radius: 28px; margin-bottom: 24px; }
      .document-kicker { display: inline-block; font: 700 12px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #9a3412; margin-bottom: 12px; }
      .document-hero h1 { margin: 0; font-size: clamp(32px, 4.8vw, 54px); line-height: 1.05; color: #111827; }
      .document-hero p { margin: 14px 0 0; font: 500 17px/1.6 ui-sans-serif, system-ui, sans-serif; color: #475569; }
      .doc-section { padding: 28px 30px; border-radius: 24px; margin-bottom: 18px; }
      .doc-section h2 { margin: 0 0 14px; font-size: 28px; line-height: 1.15; color: #0f172a; }
      .doc-section p { margin: 0 0 14px; font-size: 18px; line-height: 1.75; }
      .doc-section ul { margin: 0 0 14px; padding-left: 1.35rem; }
      .doc-section li { margin: 0 0 10px; font-size: 18px; line-height: 1.65; }
      .doc-table-wrap { overflow-x: auto; margin-top: 12px; }
      .doc-table { width: 100%; border-collapse: collapse; font: 500 15px/1.45 ui-sans-serif, system-ui, sans-serif; }
      .doc-table th, .doc-table td { padding: 12px 14px; border: 1px solid rgba(148,163,184,.28); text-align: left; vertical-align: top; }
      .doc-table th { background: #e2e8f0; color: #0f172a; font-weight: 700; }
      .doc-table td { background: #fff; color: #334155; }
    </style>`)
  }

  const html = renderMarkdownPreviewBlocks(content)

  return createPreviewHtml(title, `<main class="markdown-preview">${html}</main><style>
    body { margin: 0; background: #0f172a; color: #e5e7eb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .markdown-preview { max-width: 860px; margin: 0 auto; padding: 40px 28px; line-height: 1.7; }
    h1, h2, h3 { color: #fff; line-height: 1.2; margin: 1.2em 0 .5em; }
    h1 { font-size: 2.4rem; } h2 { font-size: 1.7rem; } h3 { font-size: 1.25rem; }
    p, li { font-size: 1rem; } ul { padding-left: 1.4rem; }
    .doc-table-wrap { overflow-x: auto; margin: 1.25rem 0; border-radius: 14px; border: 1px solid rgba(148,163,184,.28); }
    .doc-table { width: 100%; border-collapse: collapse; background: rgba(15,23,42,.72); }
    .doc-table th, .doc-table td { padding: 12px 14px; border: 1px solid rgba(148,163,184,.2); text-align: left; vertical-align: top; }
    .doc-table th { background: rgba(255,255,255,.08); color: #fff; font-weight: 700; }
    .doc-table td { color: #dbeafe; }
  </style>`)
}

function createPresentationPreviewHtml(title: string, content: string): string {
  const presentationSpec = normalizePresentationPreviewSpec(title, content)
  if (presentationSpec) {
    const slides = presentationSpec.slides.map((slide, index) => {
      const bullets = slide.bullets
        .map(line => `<li>${escapeXml(line)}</li>`)
        .join('')

      return `<article class="slide-card">
        <span class="slide-kicker">Slide ${index + 1}</span>
        <h2>${escapeXml(slide.title)}</h2>
        ${bullets ? `<ul>${bullets}</ul>` : '<p>No slide content provided.</p>'}
      </article>`
    }).join('')

    return createPreviewHtml(presentationSpec.title, `<main class="deck-preview">
      <section class="deck-hero">
        <span>Presentation Artifact</span>
        <h1>${escapeXml(presentationSpec.title)}</h1>
        <p>${presentationSpec.slides.length} slide${presentationSpec.slides.length === 1 ? '' : 's'} ready for preview and PPTX download.${presentationSpec.subtitle ? ` ${escapeXml(presentationSpec.subtitle)}` : ''}</p>
      </section>
      <section class="slides">${slides}</section>
    </main>
    <style>
      body { margin: 0; background: #09090f; color: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .deck-preview { min-height: 100vh; padding: 32px; background: radial-gradient(circle at top left, rgba(217,119,87,.28), transparent 36%), #09090f; }
      .deck-hero { max-width: 980px; margin: 0 auto 24px; padding: 28px; border: 1px solid rgba(255,255,255,.12); border-radius: 28px; background: rgba(255,255,255,.06); box-shadow: 0 24px 90px rgba(0,0,0,.35); }
      .deck-hero span { color: #c4b5fd; text-transform: uppercase; letter-spacing: .16em; font-size: 12px; font-weight: 800; }
      .deck-hero h1 { margin: 10px 0; font-size: clamp(32px, 5vw, 60px); letter-spacing: -.04em; }
      .deck-hero p { margin: 0; color: #cbd5e1; }
      .slides { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
      .slide-card { min-height: 280px; padding: 30px; border-radius: 26px; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(135deg, rgba(205,98,67,.28), rgba(236,72,153,.14)); box-shadow: 0 18px 70px rgba(0,0,0,.28); }
      .slide-kicker { color: #f0abfc; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      .slide-card h2 { margin: 12px 0 18px; font-size: clamp(26px, 4vw, 42px); line-height: 1.05; }
      .slide-card li, .slide-card p { color: #e2e8f0; font-size: 18px; line-height: 1.55; }
      .slide-card ul { display: grid; gap: 10px; padding-left: 1.25rem; }
    </style>`)
  }

  const slideBlocks = content
    .split(/\n\s*---+\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)

  const slides = (slideBlocks.length ? slideBlocks : [content]).map((block, index) => {
    const lines = block.split(/\n/).map(line => line.trim()).filter(Boolean)
    const heading = lines[0]?.replace(/^#+\s*/, '').replace(/^slide\s*\d+\s*[:.-]\s*/i, '') || `Slide ${index + 1}`
    const bullets = lines.slice(1)
      .map(line => line.replace(/^[-*\u2022â€¢]\s*/, ''))
      .filter(Boolean)
      .map(line => `<li>${escapeXml(line)}</li>`)
      .join('')

    return `<article class="slide-card">
      <span class="slide-kicker">Slide ${index + 1}</span>
      <h2>${escapeXml(heading)}</h2>
      ${bullets ? `<ul>${bullets}</ul>` : `<p>${escapeXml(block)}</p>`}
    </article>`
  }).join('')

  return createPreviewHtml(title, `<main class="deck-preview">
    <section class="deck-hero">
      <span>Presentation Artifact</span>
      <h1>${escapeXml(title)}</h1>
      <p>${slideBlocks.length || 1} slide${(slideBlocks.length || 1) === 1 ? '' : 's'} ready for preview and PPTX download.</p>
    </section>
    <section class="slides">${slides}</section>
  </main>
  <style>
    body { margin: 0; background: #09090f; color: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .deck-preview { min-height: 100vh; padding: 32px; background: radial-gradient(circle at top left, rgba(217,119,87,.28), transparent 36%), #09090f; }
    .deck-hero { max-width: 980px; margin: 0 auto 24px; padding: 28px; border: 1px solid rgba(255,255,255,.12); border-radius: 28px; background: rgba(255,255,255,.06); box-shadow: 0 24px 90px rgba(0,0,0,.35); }
    .deck-hero span { color: #c4b5fd; text-transform: uppercase; letter-spacing: .16em; font-size: 12px; font-weight: 800; }
    .deck-hero h1 { margin: 10px 0; font-size: clamp(32px, 5vw, 60px); letter-spacing: -.04em; }
    .deck-hero p { margin: 0; color: #cbd5e1; }
    .slides { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
    .slide-card { min-height: 280px; padding: 30px; border-radius: 26px; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(135deg, rgba(205,98,67,.28), rgba(236,72,153,.14)); box-shadow: 0 18px 70px rgba(0,0,0,.28); }
    .slide-kicker { color: #f0abfc; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .slide-card h2 { margin: 12px 0 18px; font-size: clamp(26px, 4vw, 42px); line-height: 1.05; }
    .slide-card li, .slide-card p { color: #e2e8f0; font-size: 18px; line-height: 1.55; }
    .slide-card ul { display: grid; gap: 10px; padding-left: 1.25rem; }
  </style>`)
}

function createTablePreviewHtml(title: string, content: string): string {
  const spreadsheetSpec = normalizeSpreadsheetPreviewSpec(title, content)
  const rows = spreadsheetSpec
    ? [
        ...(spreadsheetSpec.headers.length > 0 ? [spreadsheetSpec.headers] : []),
        ...spreadsheetSpec.rows.map((row) => (
          spreadsheetSpec.headers.length > 0
            ? Array.from({ length: spreadsheetSpec.headers.length }, (_, index) => row[index] || '')
            : row
        )),
      ]
    : parseDelimitedRows(content)

  const tableRows = rows.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td'
    return `<tr>${row.map(cell => `<${tag}>${escapeXml(cell)}</${tag}>`).join('')}</tr>`
  }).join('')

  return createPreviewHtml(spreadsheetSpec?.title || title, `<main class="table-preview">
    <section class="table-card">
      <span>Data Artifact</span>
      <h1>${escapeXml(spreadsheetSpec?.title || title)}</h1>
      <div class="table-wrap">
        <table>${tableRows || `<tr><td>${escapeXml(content)}</td></tr>`}</table>
      </div>
    </section>
  </main>
  <style>
    body { margin: 0; min-height: 100vh; background: #0f172a; color: #e5e7eb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .table-preview { min-height: 100vh; padding: 32px; background: radial-gradient(circle at top right, rgba(14,165,233,.22), transparent 36%), #0f172a; }
    .table-card { max-width: 980px; margin: 0 auto; padding: 28px; border-radius: 26px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.055); box-shadow: 0 24px 90px rgba(0,0,0,.28); }
    span { color: #67e8f9; text-transform: uppercase; letter-spacing: .14em; font-size: 12px; font-weight: 800; }
    h1 { margin: 10px 0 24px; font-size: clamp(28px, 4vw, 46px); }
    .table-wrap { overflow: auto; border-radius: 18px; border: 1px solid rgba(255,255,255,.12); }
    table { width: 100%; border-collapse: collapse; background: rgba(15,23,42,.7); }
    th, td { padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; }
    th { background: rgba(255,255,255,.08); color: #fff; }
    td { color: #dbeafe; }
  </style>`)
}

function createJsonPreviewHtml(title: string, content: string): string {
  let formatted = content
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    formatted = content
  }

  return createPreviewHtml(title, `<main><h1>${escapeXml(title)}</h1><pre>${escapeXml(formatted)}</pre></main><style>
    body { margin: 0; background: #111827; color: #e5e7eb; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    main { padding: 28px; }
    h1 { font: 600 20px Inter, ui-sans-serif, system-ui, sans-serif; color: white; }
    pre { overflow: auto; padding: 20px; border-radius: 14px; background: #020617; border: 1px solid rgba(255,255,255,.1); }
  </style>`)
}

function createSvgPreviewHtml(title: string, content: string): string {
  return createPreviewHtml(title, `<main>${content}</main><style>
    body { margin: 0; min-height: 100vh; background: #111827; display: grid; place-items: center; }
    main { width: min(90vw, 900px); height: min(80vh, 700px); display: grid; place-items: center; padding: 24px; }
    svg { max-width: 100%; max-height: 100%; }
  </style>`)
}

function createCssPreviewHtml(title: string, content: string): string {
  return createPreviewHtml(title, `<main><section class="demo-card"><span class="eyebrow">CSS Preview</span><h1>${escapeXml(title)}</h1><p>This preview applies the generated CSS to a sample card.</p><button>Sample button</button></section></main><style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .demo-card { padding: 36px; border-radius: 24px; background: white; color: #111827; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    .eyebrow { color: #7c3aed; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; font-size: 12px; }
    button { padding: 10px 16px; border: 0; border-radius: 10px; background: #7c3aed; color: white; }
    ${content}
  </style>`)
}

function createJavaScriptPreviewHtml(title: string, content: string): string {
  return createPreviewHtml(title, `<main><h1>${escapeXml(title)}</h1><p>JavaScript preview console:</p><pre id="output"></pre></main><script>
    const output = document.getElementById('output');
    const originalLog = console.log;
    console.log = (...args) => {
      output.textContent += args.map(value => typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)).join(' ') + '\\n';
      originalLog(...args);
    };
    try {
      ${content}
    } catch (error) {
      output.textContent += 'Error: ' + error.message;
    }
  </script><style>
    body { margin: 0; background: #111827; color: #e5e7eb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    main { padding: 28px; }
    pre { min-height: 220px; padding: 18px; border-radius: 14px; background: #020617; border: 1px solid rgba(255,255,255,.1); color: #a7f3d0; }
  </style>`)
}

function createTextPreviewHtml(title: string, content: string): string {
  return createPreviewHtml(title, `<main><h1>${escapeXml(title)}</h1><pre>${escapeXml(content)}</pre></main><style>
    body { margin: 0; background: #111827; color: #e5e7eb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 900px; margin: 0 auto; padding: 36px 28px; }
    pre { white-space: pre-wrap; line-height: 1.7; font: inherit; }
  </style>`)
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
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewRuntimeError, setPreviewRuntimeError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const latestWidthRef = useRef(width)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
      setViewportWidth(window.innerWidth)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    setCurrentWidth(width)
  }, [width])

  useEffect(() => {
    if (!artifact) return
    const previewable = PREVIEWABLE_LANGUAGES.has(artifact.language)
    setActiveTab(previewable ? 'preview' : 'code')
    setRefreshKey(k => k + 1)
    setIsPreviewLoading(previewable)
    setPreviewRuntimeError(null)
  }, [artifact])

  useEffect(() => {
    if (!isOpen) return

    const handlePreviewMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const payload = event.data
      if (!payload || payload.type !== PREVIEW_EVENT_TYPE) return

      if (payload.kind === 'ready') {
        setIsPreviewLoading(false)
        setPreviewRuntimeError(null)
        return
      }

      if (payload.kind === 'error') {
        const detail = payload.detail || {}
        const parts = [
          detail.message,
          detail.source ? `in ${detail.source}` : null,
          typeof detail.line === 'number' ? `line ${detail.line}` : null,
        ].filter(Boolean)
        const message = parts.join(' ') || 'Preview runtime error'
        setIsPreviewLoading(false)
        setPreviewRuntimeError(message)
      }
    }

    window.addEventListener('message', handlePreviewMessage)
    return () => window.removeEventListener('message', handlePreviewMessage)
  }, [isOpen, refreshKey])

  useEffect(() => {
    if (!isResizing) return

    let frame = 0
    const applyWidth = () => {
      frame = 0
      setCurrentWidth(latestWidthRef.current)
    }

    const handlePointerMove = (e: PointerEvent) => {
      // Distance from pointer to the right edge of the window, clamped.
      const newWidth = window.innerWidth - e.clientX
      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT
      latestWidthRef.current = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth))
      // Coalesce updates to one per animation frame for a buttery 1:1 drag.
      if (!frame) frame = requestAnimationFrame(applyWidth)
    }

    const stopResize = () => {
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      if (frame) cancelAnimationFrame(frame)
      setCurrentWidth(latestWidthRef.current)
      if (typeof window !== 'undefined') {
        localStorage.setItem('easyplus-artifact-panel-width', String(Math.round(latestWidthRef.current)))
      }
      onWidthChange?.(latestWidthRef.current)
    }

    // Listen on window so the drag keeps tracking even past the panel edge.
    // A full-window overlay (rendered while resizing) sits above the preview
    // iframe so it can never swallow these pointer events mid-drag.
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }
  }, [isResizing, onWidthChange])

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    latestWidthRef.current = currentWidth
    setIsResizing(true)

    // Prevent text selection / native scroll during the drag.
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

  const canPreview = !!artifact && PREVIEWABLE_LANGUAGES.has(artifact.language)
  const isReact = artifact?.language === 'tsx' || artifact?.language === 'jsx'
  const isGeneratedFilePreview = !!artifact && isGeneratedFileArtifactLanguage(artifact.language)
  const previewBlocked = false
  const zipPreviewArtifact = artifact as ArtifactWithZipPreview | null
  const zipBackedAttachment = artifact?.generatedAttachment?.mimeType === 'application/zip'
    ? artifact.generatedAttachment
    : null
  const generatedDownloadExtension =
    artifact && isGeneratedFileArtifactLanguage(artifact.language)
      ? getGeneratedFileExtension(artifact.language)
      : null
  const currentTab = activeTab

  const getCodeDisplayContent = (artifact: Artifact | null): string => {
    if (!artifact) return ''

    const zipFiles = (artifact as ArtifactWithZipPreview).zipPreviewFiles
    if (!zipFiles?.length) return artifact.code

    return zipFiles
      .map((file) => `// ${file.path}\n${file.content}`)
      .join('\n\n')
  }

  const getDownloadPayload = (artifact: Artifact): { filename: string; mimeType: string; content: string | Blob } => {
    const safeBaseName = (artifact.title || 'artifact')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'artifact'

    const mapping: Record<string, { extension: string; mimeType: string }> = {
      html: { extension: 'html', mimeType: 'text/html;charset=utf-8' },
      canva: { extension: 'html', mimeType: 'text/html;charset=utf-8' },
      tsx: { extension: 'tsx', mimeType: 'text/plain;charset=utf-8' },
      jsx: { extension: 'jsx', mimeType: 'text/plain;charset=utf-8' },
      javascript: { extension: 'js', mimeType: 'text/javascript;charset=utf-8' },
      typescript: { extension: 'ts', mimeType: 'text/plain;charset=utf-8' },
      css: { extension: 'css', mimeType: 'text/css;charset=utf-8' },
      python: { extension: 'py', mimeType: 'text/plain;charset=utf-8' },
      markdown: { extension: 'md', mimeType: 'text/markdown;charset=utf-8' },
      json: { extension: 'json', mimeType: 'application/json;charset=utf-8' },
      svg: { extension: 'svg', mimeType: 'image/svg+xml;charset=utf-8' },
      text: { extension: 'txt', mimeType: 'text/plain;charset=utf-8' },
    }

    const selected = mapping[artifact.language] || { extension: 'txt', mimeType: 'text/plain;charset=utf-8' }
    return {
      filename: `${safeBaseName}.${selected.extension}`,
      mimeType: selected.mimeType,
      content: decodePossiblyEscapedText(artifact.code),
    }
  }

  const getPreviewSrcDoc = (artifact: Artifact): string => {
    if (artifact.language === 'canva') return createCanvaHtml(artifact.title, artifact.code)
    if (artifact.language === 'html') return createPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'docx' || artifact.language === 'gdoc') return createMarkdownPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'pptx' || artifact.language === 'gslides') return createPresentationPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'pdf') return createMarkdownPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'xlsx' || artifact.language === 'gsheet') return createTablePreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'markdown') return createMarkdownPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'json') return createJsonPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'svg') return createSvgPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'css') return createCssPreviewHtml(artifact.title, artifact.code)
    if (artifact.language === 'javascript') return createJavaScriptPreviewHtml(artifact.title, artifact.code)
    return createTextPreviewHtml(artifact.title, artifact.code)
  }

  // Get display label for artifact language
  const getLanguageLabel = (artifact: Artifact | null): string => {
    if (!artifact) return 'No artifact'

    const lang = artifact.language
    const code = artifact.code || ''

    if (isGeneratedFileArtifactLanguage(lang)) {
      return getGeneratedFileLabel(lang)
    }

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
    if (lang === 'typescript') return 'TypeScript'
    if (lang === 'python') return 'Python'
    if (lang === 'css') return 'CSS'
    if (lang === 'markdown') return 'Markdown'
    if (lang === 'json') return 'JSON'
    if (lang === 'svg') return 'SVG'
    if (lang === 'xlsx') return 'Excel'
    if (lang === 'gsheet') return 'Google Sheets'
    if (lang === 'canva') return 'Canva-style HTML'

    return lang.toUpperCase()
  }

  const getArtifactSubtitle = (artifact: Artifact | null): string => {
    if (!artifact) return 'No artifact selected'
    if (isGeneratedFileArtifactLanguage(artifact.language)) {
      return `${getGeneratedFileLabel(artifact.language)} preview`
    }
    if (artifact.generatedAttachment?.mimeType === 'application/zip') {
      const previewPath = (artifact as ArtifactWithZipPreview).zipPreviewPath
      return previewPath ? `HTML preview from ${previewPath}` : 'HTML preview from ZIP'
    }
    return `${getLanguageLabel(artifact)} artifact`
  }

  const getGeneratedFileDownloadUrl = (artifact: Artifact): string | null => {
    if (!isGeneratedFileArtifactLanguage(artifact.language) && artifact.generatedAttachment?.mimeType !== 'application/zip') return null
    const attachment = artifact.generatedAttachment
    if (attachment?.attachmentId) {
      return `/api/attachments/file?attachmentId=${encodeURIComponent(attachment.attachmentId)}&download=1`
    }
    const storageKey = attachment?.storageKey || attachment?.storagePath
    if (storageKey) {
      const name = attachment?.name || (
        isGeneratedFileArtifactLanguage(artifact.language)
          ? `${artifact.title}.${getGeneratedFileExtension(artifact.language)}`
          : `${artifact.title}.zip`
      )
      const mimeType = attachment?.mimeType || 'application/octet-stream'
      return `/api/attachments/file?key=${encodeURIComponent(storageKey)}&name=${encodeURIComponent(name)}&mimeType=${encodeURIComponent(mimeType)}&download=1`
    }
    return null
  }

  const renderPanelContent = (options?: { fullscreen?: boolean }) => (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ paddingLeft: isMobile || options?.fullscreen ? 0 : '12px' }}
    >
      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-gradient-to-r from-white/[0.055] via-white/[0.025] to-clay-500/[0.045] p-4 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-white truncate sm:text-xl">
            {artifact?.title || 'No Artifact'}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {getArtifactSubtitle(artifact)}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1">
          {!isMobile && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsFullscreen(value => !value)}
              className="hover:bg-white/10"
              title={isFullscreen ? 'Exit full screen' : 'Open full screen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="hover:bg-white/10"
            title="Close artifact"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Tabs and Controls */}
      <div className="shrink-0 border-b border-white/[0.06] bg-black/20 px-3 py-2 sm:px-4 flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-1">
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors flex items-center gap-2',
              currentTab === 'preview'
                ? 'bg-clay-500/20 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            )}
          >
            <Eye className="h-4 w-4" />
            Preview
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors flex items-center gap-2',
              currentTab === 'code'
                ? 'bg-clay-500/20 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            )}
          >
            <Code className="h-4 w-4" />
            View Code
          </button>
        </div>

        {canPreview && currentTab === 'preview' && artifact?.code && (
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.025] p-1">
            {/* Responsive-breakpoint toggle is a desktop-only tool — on a phone
                you're already on mobile, so hide it and keep just Refresh. */}
            {!isMobile && (
              <>
                <button
                  onClick={() => setPreviewDevice('desktop')}
                  title="Desktop view"
                  className={cn(
                    'p-2 rounded transition-colors',
                    previewDevice === 'desktop'
                      ? 'bg-clay-500/15 text-clay-400'
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
                      ? 'bg-clay-500/15 text-clay-400'
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
                      ? 'bg-clay-500/15 text-clay-400'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Smartphone className="h-4 w-4" />
                </button>
                <div className="w-px h-6 bg-white/10 mx-1" />
              </>
            )}
            <button
              onClick={() => {
                setPreviewRuntimeError(null)
                setIsPreviewLoading(true)
                setRefreshKey(k => k + 1)
              }}
              title="Refresh preview"
              className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#12100e]">
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
            <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col items-center justify-center bg-[radial-gradient(circle_at_top,rgba(217,119,87,0.14),transparent_36%),#0e0c0a] p-4">
              {/* Interactive hint for games/apps */}
              <div className="text-center mb-2">
                <p className="text-xs text-gray-400">
                  {isGeneratedFilePreview
                    ? `${getLanguageLabel(artifact)} preview is limited. Download the file to open it in the native app.`
                    : 'Click inside preview to interact. Press keys for controls.'}
                </p>
              </div>
              {(previewBlocked || previewRuntimeError) && (
                <div className="mb-3 w-full max-w-5xl rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-100">Preview needs attention</p>
                      <p className="mt-1 text-sm text-amber-50/90">
                        {previewRuntimeError || artifact.validationError}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="border border-white/10 bg-white/5 hover:bg-white/10"
                        onClick={() => setActiveTab('code')}
                      >
                        View broken code
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="border border-white/10 bg-white/5 hover:bg-white/10"
                        onClick={() => {
                          setPreviewRuntimeError(null)
                          setIsPreviewLoading(true)
                          setRefreshKey(k => k + 1)
                        }}
                      >
                        Reload preview
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <div
                className="relative bg-white rounded-2xl shadow-[0_30px_120px_rgba(0,0,0,0.45)] overflow-hidden border border-white/15 transition-all duration-300 cursor-pointer"
                style={{
                  width: previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%',
                  maxWidth: '100%',
                  height: previewDevice === 'desktop' ? 'calc(100% - 28px)' : 'auto',
                  maxHeight: previewDevice === 'desktop' ? '100%' : 'calc(100% - 28px)',
                }}
                onClick={() => iframeRef.current?.focus()}
              >
                {isPreviewLoading && !previewBlocked && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-slate-700">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading preview
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  key={refreshKey}
                  srcDoc={getPreviewSrcDoc(artifact)}
                  title={artifact.title}
                  sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
                  allow="autoplay; clipboard-write; fullscreen"
                  className="w-full h-full border-0 bg-white pointer-events-auto"
                  style={{
                    minHeight: previewDevice !== 'desktop' ? '600px' : undefined,
                  }}
                  tabIndex={0}
                  onLoad={() => {
                    if (!previewBlocked) {
                      setIsPreviewLoading(false)
                    }
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
                <h4 className="text-lg font-semibold text-white">Code preview unavailable</h4>
                <p className="text-sm text-gray-400">
                  {artifact.language === 'python'
                    ? 'Python and Pygame artifacts cannot run inside the browser preview yet. Download the file and run it locally with Python.'
                    : 'This artifact type cannot be rendered safely in the browser preview yet. Use View Code to inspect, copy, or download the source.'}
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
                  : artifact.language === 'typescript'
                    ? 'typescript'
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
              {getCodeDisplayContent(artifact)}
            </SyntaxHighlighter>
          </div>
        )}
      </div>

      {/* Actions */}
      {artifact && artifact.code && (
        <div className="shrink-0 border-t border-white/[0.06] bg-black/25 p-3 sm:p-4 flex flex-wrap gap-2 sm:gap-3">
          <Button
            onClick={handleCopy}
            className="min-w-[130px] flex-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1]"
            variant="ghost"
          >
            <Copy className="h-4 w-4 mr-2" />
            {['docx', 'gdoc', 'xlsx', 'gsheet', 'pptx', 'gslides', 'pdf'].includes(artifact.language)
              ? 'Copy Preview'
              : zipPreviewArtifact?.zipPreviewFiles?.length
                ? 'Copy Files'
                : 'Copy Code'}
          </Button>
          <Button
            onClick={handleDownload}
            className="min-w-[130px] flex-1 bg-clay-600/80 hover:bg-clay-600 text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            {zipBackedAttachment
              ? 'Download ZIP'
              : isGeneratedFilePreview
              ? `Download ${generatedDownloadExtension?.toUpperCase() || 'FILE'}`
              : 'Download'}
          </Button>
          {!isGeneratedFilePreview && !zipBackedAttachment && (
            <Button
              onClick={handleDownloadZip}
              className="min-w-[130px] flex-1 bg-clay-600/80 hover:bg-clay-600 text-white"
            >
              <Download className="h-4 w-4 mr-2" />
              Download ZIP
            </Button>
          )}
        </div>
      )}
    </div>
  )

  const handleCopy = () => {
    if (!artifact?.code) return
    navigator.clipboard.writeText(getCodeDisplayContent(artifact))
    toast({
      title: 'Copied to clipboard',
      description: isGeneratedFilePreview
        ? 'Preview content copied successfully'
        : zipPreviewArtifact?.zipPreviewFiles?.length
          ? 'Artifact files copied successfully'
          : 'Artifact code copied successfully',
    })
  }

  const handleDownload = () => {
    if (!artifact?.code) return

    if (zipBackedAttachment) {
      const downloadUrl = getGeneratedFileDownloadUrl(artifact)
      if (!downloadUrl) {
        toast({
          title: 'Download failed',
          description: 'ZIP package could not be downloaded correctly. Please try again.',
          variant: 'destructive',
        })
        return
      }

      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
      toast({
        title: 'Download started',
        description: `Downloading ${artifact.generatedAttachment?.name || `${artifact.title}.zip`}`,
      })
      return
    }

    if (isGeneratedFileArtifactLanguage(artifact.language)) {
      const downloadUrl = getGeneratedFileDownloadUrl(artifact)
      if (!downloadUrl) {
        toast({
          title: 'Download failed',
          description: artifact.language === 'pptx' || artifact.language === 'gslides'
            ? 'PowerPoint file could not be generated correctly. Please try again.'
            : artifact.language === 'docx' || artifact.language === 'gdoc'
              ? 'Word document could not be generated correctly. Please try again.'
              : 'PDF file could not be generated correctly. Please try again.',
          variant: 'destructive',
        })
        return
      }

      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
      toast({
        title: 'Download started',
        description: `Downloading ${artifact.generatedAttachment?.name || `${artifact.title}.${getGeneratedFileExtension(artifact.language)}`}`,
      })
      return
    }

    const payload = getDownloadPayload(artifact)
    const blob = artifact.language === 'xlsx' || artifact.language === 'gsheet'
      ? createXlsxBlob(artifact.title, artifact.code)
      : new Blob([payload.content], { type: payload.mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = payload.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: 'Downloaded',
      description: `Artifact saved as ${payload.filename}`,
    })
  }

  const handleDownloadZip = async () => {
    if (!artifact?.code) return

    const extensions: Record<string, string> = {
      html: 'html',
      tsx: 'tsx',
      jsx: 'jsx',
      javascript: 'js',
      typescript: 'ts',
      css: 'css',
      python: 'py',
      markdown: 'md',
      json: 'json',
      svg: 'svg',
      text: 'txt',
      docx: 'txt',
      gdoc: 'txt',
      xlsx: 'csv',
      gsheet: 'csv',
      pptx: 'txt',
      gslides: 'txt',
      canva: 'html',
    }
    const baseName = artifact.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'artifact'
    const extension = extensions[artifact.language] || 'txt'

    try {
      const response = await fetch('/api/generated-files/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `${baseName}.zip`,
          files: [{ path: `${baseName}.${extension}`, content: artifact.code }],
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to generate ZIP. Please try again.')
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer')
    } catch (error: any) {
      toast({
        title: 'Failed to generate ZIP',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      })
    }
  }

  return (
    <>
      {/* While dragging the resize handle, a transparent full-window overlay
          sits above the preview iframe so it cannot capture pointer events and
          break the drag. This is what keeps the resize buttery and 1:1. */}
      {isResizing && (
        <div
          className="fixed inset-0 z-[200]"
          style={{ cursor: 'col-resize', touchAction: 'none' }}
        />
      )}

      {/* Mobile: Fixed overlay full-screen */}
      {isMobile && isOpen && (
        <AnimatePresence>
          <motion.div
            ref={panelRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-0 z-50 bg-[#12100e] md:hidden"
          >
            {renderPanelContent({ fullscreen: true })}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Desktop: True fullscreen overlay */}
      {!isMobile && isOpen && isFullscreen && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-3 z-50 hidden md:block"
          >
            <div className="h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111111] shadow-[0_40px_140px_rgba(0,0,0,0.55)]">
              {renderPanelContent({ fullscreen: true })}
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Desktop: Docked flex child */}
      {!isMobile && isOpen && !isFullscreen && (
        <aside
          ref={panelRef}
          className="hidden md:flex relative h-full min-h-0 flex-shrink-0 flex-col border-l border-white/[0.06] bg-[#111111] shadow-2xl"
          style={{ width: `${currentWidth}px` }}
        >
          {/* Resize Handle - Desktop Only - Full Height */}
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center group',
              'hover:bg-clay-500/5 transition-colors',
              isResizing && 'bg-clay-500/10'
            )}
            style={{
              zIndex: 100,
              pointerEvents: 'auto',
              touchAction: 'none',
            }}
            onPointerDown={handleResizeStart}
          >
            {/* Vertical line spanning full height */}
            <div className={cn(
              'absolute left-1 w-px h-full bg-white/10 transition-colors',
              'group-hover:bg-clay-400/40',
              isResizing && 'bg-clay-400/60'
            )} />
            {/* Centered grip indicator */}
            <div className={cn(
              'absolute top-1/2 left-0.5 -translate-y-1/2 w-1.5 h-16 rounded-full bg-clay-400/40 transition-opacity',
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
