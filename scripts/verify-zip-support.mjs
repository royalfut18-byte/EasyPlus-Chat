import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function loadArtifactRoutingModule() {
  let source = fs.readFileSync('lib/artifact-routing.ts', 'utf8')
  source = source.replace(/import type \{ Artifact \} from '@\/types\/models'\r?\n/, 'type Artifact = { title: string; language: string; code: string }\n')
  source = source.replace(/import \{ detectGeneratedFileIntent \} from '@\/lib\/generated-files'\r?\n/, 'const detectGeneratedFileIntent = () => null\n')

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  })

  const moduleRef = { exports: {} }
  vm.runInNewContext(transpiled.outputText, {
    module: moduleRef,
    exports: moduleRef.exports,
    console,
  }, { filename: 'lib/artifact-routing.ts' })

  return moduleRef.exports
}

const { detectZipProjectIntent } = loadArtifactRoutingModule()
assert(typeof detectZipProjectIntent === 'function', 'detectZipProjectIntent must export correctly')

assert(
  detectZipProjectIntent('Build me a downloadable starter project ZIP for a todo app'),
  'ZIP generation intent should be detected for downloadable project requests'
)

assert(
  detectZipProjectIntent('Update this uploaded codebase and give me back an updated zip with all files'),
  'ZIP generation intent should be detected for updated ZIP requests'
)

assert(
  !detectZipProjectIntent('Read this zip file and explain what the code does'),
  'Read-only ZIP questions should not be routed into ZIP generation mode'
)

assert(
  !detectZipProjectIntent('Analyze this codebase and summarise the architecture'),
  'Codebase analysis requests should not be treated as ZIP generation requests'
)

const systemPromptSource = fs.readFileSync('lib/ai/system-prompt.ts', 'utf8')
assert(
  systemPromptSource.includes('generated_zip') && systemPromptSource.includes('uploaded ZIP/codebase'),
  'System prompt must explain generated_zip output and read-only ZIP behavior'
)

const messageUtilsSource = fs.readFileSync('lib/chat/message-utils.ts', 'utf8')
assert(
  messageUtilsSource.includes('createGeneratedZipPreviewArtifact') &&
  messageUtilsSource.includes("attachment.mimeType === 'application/zip'"),
  'Loaded messages must reconstruct ZIP-backed artifact previews from saved assistant messages'
)

const chatPageSource = fs.readFileSync('app/chat/page.tsx', 'utf8')
assert(
  chatPageSource.includes('buildZipProjectInstructions'),
  'Chat page must define ZIP project instructions'
)

assert(
  chatPageSource.includes('requestZipProjectMode') && chatPageSource.includes('Creating ZIP package...'),
  'Chat page must route ZIP project requests and show ZIP-specific status text'
)

assert(
  chatPageSource.includes('```generated_zip') && chatPageSource.includes('type": "generated_zip"'),
  'Chat page ZIP instructions must require generated_zip manifests'
)

assert(
  chatPageSource.includes('recoverArtifactFromMessage') &&
  chatPageSource.includes('createGeneratedZipPreviewArtifact(generatedZipManifest, generatedZipAttachment'),
  'Chat page must recover ZIP-backed artifacts when rendering previous assistant messages'
)

console.log('PASS ZIP project requests are routed into generated_zip mode while read-only ZIP questions stay normal')
console.log('PASS chat/system prompts include explicit ZIP generation and ZIP reading guidance')
console.log('PASS saved ZIP responses rebuild artifact previews during conversation reload')
console.log('PASS previous assistant messages recover ZIP-backed artifacts during render')
