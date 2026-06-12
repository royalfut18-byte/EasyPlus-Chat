import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const sourcePath = 'lib/artifact-parser.ts'
let source = fs.readFileSync(sourcePath, 'utf8')

source = source.replace(
  /import type \{ Artifact \} from '@\/types\/models'\r?\n/,
  `type Artifact = {
    id: string
    title: string
    language: 'html' | 'tsx' | 'jsx' | 'javascript' | 'typescript' | 'css' | 'python' | 'markdown' | 'json' | 'svg' | 'text' | 'docx' | 'xlsx' | 'pptx' | 'gdoc' | 'gsheet' | 'gslides' | 'canva' | 'pdf'
    code: string
    explanation?: string
    extractionMethod?: string
    repaired?: boolean
    validationError?: string | null
    validationErrors?: string[]
    createdAt: string
  }\n`
)
source = source.replace(
  /import \{ getGeneratedFileLabel, isGeneratedFileArtifactLanguage \} from '@\/lib\/generated-files'\r?\n/,
  `const getGeneratedFileLabel = (kind) => kind === 'pdf' ? 'PDF document' : kind === 'pptx' ? 'PowerPoint presentation' : kind === 'docx' ? 'Word document' : kind;\nconst isGeneratedFileArtifactLanguage = (kind) => ['pdf', 'pptx', 'gslides', 'docx', 'gdoc'].includes(String(kind || ''));\n`
)
source = source.replace(
  /import \{ decodePossiblyEscapedText, parseGeneratedZipFromResponse \} from '@\/lib\/generated-zip'\r?\n/,
  `const decodePossiblyEscapedText = (value) => String(value || '').replace(/\\\\n/g, '\\n').replace(/\\\\t/g, '\\t').replace(/\\\\"/g, '"');\nconst parseGeneratedZipFromResponse = (content) => ({ cleanContent: content, manifest: null });\n`
)
source = source.replace(
  /import \{ buildArtifactFallback \} from '@\/lib\/artifact-fallback'\r?\n/,
  `const buildArtifactFallback = () => null;\n`
)

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
})

const moduleRef = { exports: {} }
const context = {
  module: moduleRef,
  exports: moduleRef.exports,
  console,
  process,
  setTimeout,
  clearTimeout,
}

vm.runInNewContext(transpiled.outputText, context, { filename: sourcePath })

const { parseArtifactFromResponse } = context.module.exports

assert(typeof parseArtifactFromResponse === 'function', 'parseArtifactFromResponse must export correctly')

const noisyPdfArtifact = `
advanced-stock-and-inventory-management-website-code-pack.pdf

PDF document · 29 KB · Generated

Open file
Download
OCR selected pages
artifact:pdf:Advanced Stock and Inventory Management Website Code Pack
{
  "title": "Advanced Stock and Inventory Management Website",
  "subtitle": "40+ page Year 12 Enterprise Project-aligned stock and inventory management system",
  "sections": [
    {
      "heading": "Alignment to the Attached PDF",
      "paragraphs": [
        "The attached document is the Enterprise Project Development Portfolio Scaffold."
      ]
    }
  ]
}

Preview:
{"title":"Duplicate preview that should not be captured"}
`

const noisyPdfResult = parseArtifactFromResponse(noisyPdfArtifact, true, 'Create me a stock and inventory management website PDF')
assert(noisyPdfResult.artifact, 'Expected noisy PDF artifact to be recovered')
assert(noisyPdfResult.artifact.language === 'pdf', 'Expected noisy PDF artifact language to remain pdf')
assert(noisyPdfResult.artifact.title === 'Advanced Stock and Inventory Management Website Code Pack', 'Expected noisy PDF artifact title to be recovered')
assert(noisyPdfResult.artifact.code.includes('"sections"'), 'Expected noisy PDF artifact JSON payload to be captured')
assert(!noisyPdfResult.artifact.code.includes('Duplicate preview'), 'Expected noisy PDF artifact payload to stop before duplicate preview noise')

const malformedWrapper = `
I built it for you.
<EASYPLUS_ARTIFACT type="html" title="Inventory Dashboard">
<div class="app"><button onclick="go()">Launch</button></div>
<script>function go(){document.body.dataset.ready='true'}</script>
`

const malformedWrapperResult = parseArtifactFromResponse(malformedWrapper, true, 'Build an inventory dashboard')
assert(malformedWrapperResult.artifact, 'Expected malformed EASYPLUS wrapper to recover')
assert(malformedWrapperResult.artifact.language === 'html', 'Expected malformed EASYPLUS wrapper to resolve to html')
assert(/<button/i.test(malformedWrapperResult.artifact.code), 'Expected malformed EASYPLUS wrapper to preserve HTML payload')

const embeddedHtmlArtifact = `
Some intro text before the artifact.
Preview: ignore this label.
artifact:html:Inventory Control Panel
<!DOCTYPE html>
<html>
  <body>
    <main><h1>Inventory Control Panel</h1></main>
  </body>
</html>
`

const embeddedHtmlResult = parseArtifactFromResponse(embeddedHtmlArtifact, true, 'Create an inventory control panel')
assert(embeddedHtmlResult.artifact, 'Expected embedded HTML artifact to parse')
assert(embeddedHtmlResult.artifact.language === 'html', 'Expected embedded HTML artifact language to be html')
assert(embeddedHtmlResult.artifact.title === 'Inventory Control Panel', 'Expected embedded HTML artifact title to be recovered')

console.log('PASS artifact parser recovers noisy embedded artifact outputs and malformed wrappers')
