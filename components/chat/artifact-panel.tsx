'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Download, Code, Eye, GripVertical, Package, AlertTriangle, Blocks, EyeOff, Monitor, Tablet, Smartphone, RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Artifact } from '@/types/models'
import { toast } from '@/components/ui/use-toast'
import { getGeneratedFileExtension, getGeneratedFileLabel, isGeneratedFileArtifactLanguage } from '@/lib/generated-files'
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

const HTML_INTERACTION_FALLBACK_SCRIPT = `
<script>
(function () {
  function showElement(element) {
    if (!element) return;
    element.style.display = '';
    element.classList.add('active');
  }

  function hideElement(element) {
    if (!element) return;
    element.style.display = 'none';
    element.classList.remove('active');
  }

  if (!window.showTab) {
    window.showTab = function (name) {
      document.querySelectorAll('[id$="-tab"], .tab-content, .tab-pane').forEach(hideElement);
      showElement(document.getElementById(name + '-tab') || document.getElementById(name));

      document.querySelectorAll('.tab-btn, .tab, [onclick*="showTab"]').forEach(function (button) {
        var onclick = button.getAttribute('onclick') || '';
        button.classList.toggle('active', onclick.indexOf("'" + name + "'") !== -1 || onclick.indexOf('"' + name + '"') !== -1);
      });
    };
  }

  if (!window.switchTab) {
    window.switchTab = function (name) {
      document.querySelectorAll('.tab-content, [id^="content-"], [id$="-tab"]').forEach(hideElement);
      showElement(document.getElementById('content-' + name) || document.getElementById(name + '-tab') || document.getElementById(name));

      document.querySelectorAll('.tab-btn, .tab, [onclick*="switchTab"]').forEach(function (button) {
        var onclick = button.getAttribute('onclick') || '';
        button.classList.toggle('active', onclick.indexOf("'" + name + "'") !== -1 || onclick.indexOf('"' + name + '"') !== -1);
      });
    };
  }

  if (!window.showSection) {
    window.showSection = function (name) {
      document.querySelectorAll('.section').forEach(function (section) {
        section.classList.remove('active');
        section.style.display = 'none';
      });
      showElement(document.getElementById('section-' + name) || document.getElementById(name));

      document.querySelectorAll('.tab, .tab-btn, [onclick*="showSection"]').forEach(function (button) {
        var onclick = button.getAttribute('onclick') || '';
        button.classList.toggle('active', onclick.indexOf("'" + name + "'") !== -1 || onclick.indexOf('"' + name + '"') !== -1);
      });
    };
  }

  if (!window.toggleRoom) {
    window.toggleRoom = function (room, event) {
      if (event && event.target && event.target.closest('button')) return;
      var target = typeof room === 'string' ? document.getElementById(room) : (room && room.closest ? room.closest('.room') : room);
      if (target) target.classList.toggle('open');
    };
  }

  if (!window.revealText) {
    window.revealText = function (button, event) {
      if (event) event.stopPropagation();
      var container = button && button.closest ? button.closest('.scene, .sentence-card, .step, .card') : null;
      var text = container && container.querySelector('.scene-text, .sentence-text, .step-content, .card-content, .answer');
      if (!text) return;
      var isShown = text.classList.toggle('revealed');
      text.style.display = isShown ? 'block' : '';
      if (button) button.textContent = isShown ? 'Hide Sentence' : 'Show Sentence';
    };
  }

  if (!window.toggleText) {
    window.toggleText = function (button, event) {
      if (event) event.stopPropagation();
      var container = button && button.closest ? button.closest('.scene, .sentence-card, .step, .card, .drill-card') : null;
      var text = container && container.querySelector('.scene-text, .drill-answer, .sentence-text, .step-content, .card-content, .answer');
      if (!text) return;
      var isShown = text.classList.toggle('show');
      text.classList.toggle('revealed', isShown);
      text.style.display = isShown ? 'block' : 'none';
      if (button) button.textContent = isShown ? 'Hide Full Sentence' : 'Show Full Sentence';
    };
  }

  if (!window.toggleSentence) {
    window.toggleSentence = function (card) {
      var text = card && card.querySelector ? card.querySelector('.sentence-text, .step-content, .content, .card-content') : card;
      if (!text) return;
      text.classList.toggle('hidden');
      card.classList.toggle('hidden-text');
      card.classList.toggle('revealed');
    };
  }

  if (!window.nextCard) {
    window.nextCard = function () {
      var cards = Array.from(document.querySelectorAll('.drill-card, .practice-card'));
      var current = cards.findIndex(function (card) { return card.style.display !== 'none'; });
      if (current === -1) current = 0;
      cards.forEach(hideElement);
      showElement(cards[(current + 1) % cards.length]);
    };
  }

  if (!window.prevCard) {
    window.prevCard = function () {
      var cards = Array.from(document.querySelectorAll('.drill-card, .practice-card'));
      var current = cards.findIndex(function (card) { return card.style.display !== 'none'; });
      if (current === -1) current = 0;
      cards.forEach(hideElement);
      showElement(cards[(current - 1 + cards.length) % cards.length]);
    };
  }

  if (!window.toggleBlur) {
    window.toggleBlur = function (element) {
      if (!element) return;
      element.classList.toggle('hidden');
      element.style.filter = element.classList.contains('hidden') ? 'blur(8px)' : '';
    };
  }

  if (!window.revealAll) {
    window.revealAll = function (scope) {
      var root = scope ? (document.getElementById('section-' + scope) || document.getElementById(scope)) : document;
      (root || document).querySelectorAll('.hidden, .hidden-text').forEach(function (element) {
        element.classList.remove('hidden', 'hidden-text');
        element.style.filter = '';
      });
      (root || document).querySelectorAll('.scene-text, .card-content, .step-content').forEach(function (element) {
        element.classList.add('revealed');
        element.style.display = 'block';
      });
    };
  }

  if (!window.hideAll) {
    window.hideAll = function (scope) {
      var root = scope ? (document.getElementById('section-' + scope) || document.getElementById(scope)) : document;
      (root || document).querySelectorAll('.sentence-text, .step-content, .card-content').forEach(function (element) {
        element.classList.add('hidden');
        element.classList.remove('revealed');
      });
      (root || document).querySelectorAll('.scene-text').forEach(function (element) {
        element.classList.remove('revealed');
        element.style.display = 'none';
      });
    };
  }

  function resolveSection(name) {
    return document.getElementById('sec-' + name) ||
      document.getElementById('section-' + name) ||
      document.getElementById('content-' + name) ||
      document.getElementById(name + '-tab') ||
      document.getElementById(name);
  }

  // Override common generated handlers so inline onclick attributes work even
  // when the model omitted the script or used a slightly different naming style.
  window.showSection = function (name) {
    document.querySelectorAll('.section, .tab-content, [id^="sec-"], [id^="section-"], [id^="content-"]').forEach(function (section) {
      section.classList.remove('active');
      section.style.display = 'none';
    });
    showElement(resolveSection(name));

    document.querySelectorAll('.tab, .tab-btn, [onclick*="showSection"], [onclick*="switchTab"]').forEach(function (button) {
      var onclick = button.getAttribute('onclick') || '';
      button.classList.toggle('active', onclick.indexOf("'" + name + "'") !== -1 || onclick.indexOf('"' + name + '"') !== -1);
    });
  };

  window.switchTab = function (name) {
    window.showSection(name);
  };

  window.toggleCard = function (card) {
    if (!card) return;
    card.classList.toggle('revealed');
    var hidden = card.querySelector('.card-hidden, .answer, .details');
    if (hidden) {
      var isShown = card.classList.contains('revealed');
      hidden.style.display = isShown ? 'block' : 'none';
      hidden.classList.toggle('show', isShown);
      hidden.classList.toggle('revealed', isShown);
    }
  };

  window.toggleText = function (button, event) {
    if (event) event.stopPropagation();
    var container = button && button.closest ? button.closest('.scene, .sentence-card, .step, .card, .drill-card, .test-card') : null;
    var text = container && container.querySelector('.scene-text, .drill-answer, .sentence-text, .step-content, .card-content, .card-hidden, .test-answer, .answer');
    if (!text) return;
    var isShown = text.classList.toggle('show');
    text.classList.toggle('revealed', isShown);
    text.style.display = isShown ? 'block' : 'none';
    if (button) {
      button.textContent = isShown
        ? button.textContent.replace(/^Show/i, 'Hide')
        : button.textContent.replace(/^Hide/i, 'Show');
    }
  };

  window.toggleRoom = function (room, event) {
    if (event && event.target && event.target.closest('button')) return;
    var target = typeof room === 'string' ? document.getElementById(room) : (room && room.closest ? room.closest('.room') : room);
    if (target) target.classList.toggle('open');
  };

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var tab = target.closest('.tab, .tab-btn, [data-tab], [data-section]');
    if (tab) {
      var onclick = tab.getAttribute('onclick') || '';
      var tabName = tab.getAttribute('data-tab') || tab.getAttribute('data-section');
      var match = onclick.match(/(?:showSection|switchTab|showTab)\\(['"]([^'"]+)['"]\\)/);
      if (!tabName && match) tabName = match[1];
      if (tabName) {
        event.preventDefault();
        window.showSection(tabName);
        return;
      }
    }

    var reveal = target.closest('button, [role="button"]');
    if (reveal) {
      var label = (reveal.textContent || '').toLowerCase();
      var looksLikeReveal =
        label.indexOf('show') !== -1 ||
        label.indexOf('hide') !== -1 ||
        label.indexOf('reveal') !== -1 ||
        label.indexOf('full') !== -1 ||
        label.indexOf('answer') !== -1 ||
        label.indexOf('sentence') !== -1 ||
        label.indexOf('text') !== -1;

      if (looksLikeReveal) {
        var container = reveal.closest('.scene, .sentence-card, .step, .card, .drill-card, .test-card, .flashcard, .practice-card');
        var text = container && container.querySelector('.scene-text, .drill-answer, .sentence-text, .step-content, .card-content, .card-hidden, .test-answer, .answer, .full-text, .hidden-text, [data-answer], [data-full-text]');
        if (text) {
          event.preventDefault();
          event.stopPropagation();
          var currentlyHidden = getComputedStyle(text).display === 'none' || !text.classList.contains('show') && !text.classList.contains('revealed') && (text.classList.contains('card-hidden') || text.classList.contains('test-answer') || text.classList.contains('scene-text'));
          text.classList.toggle('show', currentlyHidden);
          text.classList.toggle('revealed', currentlyHidden);
          text.classList.toggle('hidden', !currentlyHidden);
          text.style.display = currentlyHidden ? 'block' : 'none';
          reveal.textContent = currentlyHidden
            ? label.replace('show', 'hide').replace('reveal', 'hide')
            : label.replace('hide', 'show');
          return;
        }
      }
    }

    var roomHeader = target.closest('.room-header, .accordion-header, .section-header');
    if (roomHeader) {
      var room = roomHeader.closest('.room, .accordion, .collapsible, .section');
      if (room) {
        event.preventDefault();
        room.classList.toggle('open');
        room.classList.toggle('active', room.classList.contains('open'));
        return;
      }
    }

    var card = target.closest('.card, .sentence-card, .test-card, .flashcard');
    if (card && !target.closest('button, a, input, textarea, select')) {
      var hidden = card.querySelector('.card-hidden, .test-answer, .answer, .full-text, [data-answer], [data-full-text]');
      if (hidden) {
        event.preventDefault();
        card.classList.toggle('revealed');
        var isShown = card.classList.contains('revealed');
        hidden.classList.toggle('show', isShown);
        hidden.classList.toggle('revealed', isShown);
        hidden.style.display = isShown ? 'block' : 'none';
      }
    }
  }, true);
})();
</script>`

function injectHtmlInteractionFallback(html: string): string {
  if (html.includes('data-easyplus-fallback-script')) return html

  const fallback = HTML_INTERACTION_FALLBACK_SCRIPT.replace('<script>', '<script data-easyplus-fallback-script>')
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${fallback}</body>`)
  }
  if (/<\/html\s*>/i.test(html)) {
    return html.replace(/<\/html\s*>/i, `${fallback}</html>`)
  }
  return `${html}\n${fallback}`
}

function createPreviewHtml(title: string, content: string): string {
  const trimmed = content.trim()
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
${content}
</body>
</html>`

  return injectHtmlInteractionFallback(html)
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

function createMarkdownPreviewHtml(title: string, content: string): string {
  const html = content
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      if (/^###\s+/.test(trimmed)) return `<h3>${escapeXml(trimmed.replace(/^###\s+/, ''))}</h3>`
      if (/^##\s+/.test(trimmed)) return `<h2>${escapeXml(trimmed.replace(/^##\s+/, ''))}</h2>`
      if (/^#\s+/.test(trimmed)) return `<h1>${escapeXml(trimmed.replace(/^#\s+/, ''))}</h1>`
      if (/^[-*]\s+/m.test(trimmed)) {
        const items = trimmed.split(/\n/).filter(Boolean).map(line => `<li>${escapeXml(line.replace(/^[-*]\s+/, ''))}</li>`).join('')
        return `<ul>${items}</ul>`
      }
      return `<p>${escapeXml(trimmed).replace(/\n/g, '<br />')}</p>`
    })
    .join('\n')

  return createPreviewHtml(title, `<main class="markdown-preview">${html}</main><style>
    body { margin: 0; background: #0f172a; color: #e5e7eb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .markdown-preview { max-width: 860px; margin: 0 auto; padding: 40px 28px; line-height: 1.7; }
    h1, h2, h3 { color: #fff; line-height: 1.2; margin: 1.2em 0 .5em; }
    h1 { font-size: 2.4rem; } h2 { font-size: 1.7rem; } h3 { font-size: 1.25rem; }
    p, li { font-size: 1rem; } ul { padding-left: 1.4rem; }
  </style>`)
}

function createPresentationPreviewHtml(title: string, content: string): string {
  const slideBlocks = content
    .split(/\n\s*---+\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)

  const slides = (slideBlocks.length ? slideBlocks : [content]).map((block, index) => {
    const lines = block.split(/\n/).map(line => line.trim()).filter(Boolean)
    const heading = lines[0]?.replace(/^#+\s*/, '').replace(/^slide\s*\d+\s*[:.-]\s*/i, '') || `Slide ${index + 1}`
    const bullets = lines.slice(1)
      .map(line => line.replace(/^[-*•]\s*/, ''))
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
    .deck-preview { min-height: 100vh; padding: 32px; background: radial-gradient(circle at top left, rgba(168,85,247,.28), transparent 36%), #09090f; }
    .deck-hero { max-width: 980px; margin: 0 auto 24px; padding: 28px; border: 1px solid rgba(255,255,255,.12); border-radius: 28px; background: rgba(255,255,255,.06); box-shadow: 0 24px 90px rgba(0,0,0,.35); }
    .deck-hero span { color: #c4b5fd; text-transform: uppercase; letter-spacing: .16em; font-size: 12px; font-weight: 800; }
    .deck-hero h1 { margin: 10px 0; font-size: clamp(32px, 5vw, 60px); letter-spacing: -.04em; }
    .deck-hero p { margin: 0; color: #cbd5e1; }
    .slides { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
    .slide-card { min-height: 280px; padding: 30px; border-radius: 26px; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(135deg, rgba(124,58,237,.28), rgba(236,72,153,.14)); box-shadow: 0 18px 70px rgba(0,0,0,.28); }
    .slide-kicker { color: #f0abfc; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .slide-card h2 { margin: 12px 0 18px; font-size: clamp(26px, 4vw, 42px); line-height: 1.05; }
    .slide-card li, .slide-card p { color: #e2e8f0; font-size: 18px; line-height: 1.55; }
    .slide-card ul { display: grid; gap: 10px; padding-left: 1.25rem; }
  </style>`)
}

function createTablePreviewHtml(title: string, content: string): string {
  const rows = content
    .split(/\n/)
    .map(line => line.trim())
    .filter(line => line && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line))
    .map(line => {
      if (line.includes('|')) {
        return line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
      }
      return line.split(',').map(cell => cell.trim())
    })
    .filter(row => row.length > 0)

  const tableRows = rows.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td'
    return `<tr>${row.map(cell => `<${tag}>${escapeXml(cell)}</${tag}>`).join('')}</tr>`
  }).join('')

  return createPreviewHtml(title, `<main class="table-preview">
    <section class="table-card">
      <span>Data Artifact</span>
      <h1>${escapeXml(title)}</h1>
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
  const panelRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

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
  }, [artifact?.id, artifact?.language])

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

  const canPreview = !!artifact && PREVIEWABLE_LANGUAGES.has(artifact.language)
  const isReact = artifact?.language === 'tsx' || artifact?.language === 'jsx'
  const isGeneratedFilePreview = !!artifact && isGeneratedFileArtifactLanguage(artifact.language)
  const generatedDownloadExtension =
    artifact && isGeneratedFileArtifactLanguage(artifact.language)
      ? getGeneratedFileExtension(artifact.language)
      : null
  const currentTab = activeTab

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
    return `${getLanguageLabel(artifact)} artifact`
  }

  const getGeneratedFileDownloadUrl = (artifact: Artifact): string | null => {
    if (!isGeneratedFileArtifactLanguage(artifact.language)) return null
    const attachment = artifact.generatedAttachment
    if (attachment?.attachmentId) {
      return `/api/attachments/file?attachmentId=${encodeURIComponent(attachment.attachmentId)}&download=1`
    }
    const storageKey = attachment?.storageKey || attachment?.storagePath
    if (storageKey) {
      const name = attachment?.name || `${artifact.title}.${getGeneratedFileExtension(artifact.language)}`
      const mimeType = attachment?.mimeType || 'application/octet-stream'
      return `/api/attachments/file?key=${encodeURIComponent(storageKey)}&name=${encodeURIComponent(name)}&mimeType=${encodeURIComponent(mimeType)}&download=1`
    }
    return null
  }

  const renderPanelContent = () => (
    <div className="flex flex-col h-full" style={{ paddingLeft: isMobile ? 0 : '12px' }}>
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-gradient-to-r from-white/[0.055] via-white/[0.025] to-fuchsia-500/[0.045] p-4 flex items-center justify-between">
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
      <div className="border-b border-white/[0.06] bg-black/20 px-3 py-2 sm:px-4 flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-1">
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors flex items-center gap-2',
              currentTab === 'preview'
                ? 'bg-violet-500/20 text-white shadow-sm'
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
                ? 'bg-violet-500/20 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            )}
          >
            <Code className="h-4 w-4" />
            View Code
          </button>
        </div>

        {canPreview && currentTab === 'preview' && artifact?.code && (
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.025] p-1">
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
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#0f0f0f]">
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
            <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col items-center justify-center bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.14),transparent_36%),#0b0b0f] p-4">
              {/* Interactive hint for games/apps */}
              <div className="text-center mb-2">
                <p className="text-xs text-gray-400">
                  {isGeneratedFilePreview
                    ? `${getLanguageLabel(artifact)} preview is limited. Download the file to open it in the native app.`
                    : 'Click inside preview to interact. Press keys for controls.'}
                </p>
              </div>
              <div
                className="bg-white rounded-2xl shadow-[0_30px_120px_rgba(0,0,0,0.45)] overflow-hidden border border-white/15 transition-all duration-300 cursor-pointer"
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
                  srcDoc={getPreviewSrcDoc(artifact)}
                  title={artifact.title}
                  sandbox="allow-scripts allow-forms"
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
              {artifact.code}
            </SyntaxHighlighter>
          </div>
        )}
      </div>

      {/* Actions */}
      {artifact && artifact.code && (
        <div className="border-t border-white/[0.06] bg-black/25 p-3 sm:p-4 flex flex-wrap gap-2 sm:gap-3">
          <Button
            onClick={handleCopy}
            className="min-w-[130px] flex-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1]"
            variant="ghost"
          >
            <Copy className="h-4 w-4 mr-2" />
            {['docx', 'gdoc', 'xlsx', 'gsheet', 'pptx', 'gslides', 'pdf'].includes(artifact.language) ? 'Copy Preview' : 'Copy Code'}
          </Button>
          <Button
            onClick={handleDownload}
            className="min-w-[130px] flex-1 bg-violet-600/80 hover:bg-violet-600 text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            {isGeneratedFilePreview
              ? `Download ${generatedDownloadExtension?.toUpperCase() || 'FILE'}`
              : 'Download'}
          </Button>
          {!isGeneratedFilePreview && (
            <Button
              onClick={handleDownloadZip}
              className="min-w-[130px] flex-1 bg-fuchsia-600/80 hover:bg-fuchsia-600 text-white"
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
    navigator.clipboard.writeText(artifact.code)
    toast({
      title: 'Copied to clipboard',
      description: isGeneratedFilePreview ? 'Preview content copied successfully' : 'Artifact code copied successfully',
    })
  }

  const handleDownload = () => {
    if (!artifact?.code) return

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
      xlsx: 'xlsx',
      gsheet: 'xlsx',
      canva: 'html',
    }

    const extension = extensions[artifact.language] || 'txt'
    const filename = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${extension}`

    const blob = artifact.language === 'xlsx' || artifact.language === 'gsheet'
        ? createXlsxBlob(artifact.title, artifact.code)
        : artifact.language === 'canva'
            ? new Blob([createCanvaHtml(artifact.title, artifact.code)], { type: 'text/html' })
            : artifact.language === 'html'
              ? new Blob([createPreviewHtml(artifact.title, artifact.code)], { type: 'text/html' })
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
      {/* Mobile: Fixed overlay full-screen */}
      {isMobile && isOpen && (
        <AnimatePresence>
          <motion.div
            ref={panelRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-0 z-50 bg-[#0f0f0f] md:hidden"
          >
            {renderPanelContent()}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Desktop: Flex child */}
      {!isMobile && isOpen && (
        <aside
          ref={panelRef}
          className="hidden md:flex relative h-full min-h-0 flex-shrink-0 flex-col border-l border-white/[0.06] bg-[#111111] shadow-2xl"
          style={{ width: `${isFullscreen ? Math.max(MIN_WIDTH, viewportWidth - 32) : currentWidth}px` }}
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
