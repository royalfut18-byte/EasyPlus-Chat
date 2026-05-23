import assert from 'node:assert/strict'
import sanitizer from '../lib/supabase/sanitize-db-text.js'

const { sanitizeDatabaseText, sanitizeJsonForDatabase } = sanitizer

const cases = [
  {
    name: 'plain academic prompt is untouched',
    input: 'Make this essay similar, but do not copy the wording.',
    expected: 'Make this essay similar, but do not copy the wording.',
  },
  {
    name: 'literal unicode escape text is untouched',
    input: String.raw`this contains \uD83D and \u0000 as visible text`,
    expected: String.raw`this contains \uD83D and \u0000 as visible text`,
  },
  {
    name: 'null byte is removed',
    input: 'before\u0000after',
    expected: 'beforeafter',
  },
  {
    name: 'emoji surrogate pair is preserved',
    input: 'essay draft ✅ 😄',
    expected: 'essay draft ✅ 😄',
  },
  {
    name: 'lone high surrogate is removed',
    input: `before${String.fromCharCode(0xd83d)}after`,
    expected: 'beforeafter',
  },
  {
    name: 'lone low surrogate is removed',
    input: `before${String.fromCharCode(0xde00)}after`,
    expected: 'beforeafter',
  },
  {
    name: 'smart quotes and multiline content are untouched',
    input: '“Quote”\nLine two\r\nLine three\tTabbed',
    expected: '“Quote”\nLine two\r\nLine three\tTabbed',
  },
  {
    name: 'backslashes are untouched',
    input: String.raw`C:\Users\Ashaz\Downloads\EasyPlus`,
    expected: String.raw`C:\Users\Ashaz\Downloads\EasyPlus`,
  },
]

for (const testCase of cases) {
  assert.equal(sanitizeDatabaseText(testCase.input), testCase.expected, testCase.name)
}

const nested = {
  content: 'hello\u0000world',
  attachments: [
    {
      name: `doc${String.fromCharCode(0xd83d)}.pdf`,
      textContent: 'keeps emoji 😄 and removes null\u0000byte',
    },
  ],
  untouched: 42,
}

assert.deepEqual(sanitizeJsonForDatabase(nested), {
  content: 'helloworld',
  attachments: [
    {
      name: 'doc.pdf',
      textContent: 'keeps emoji 😄 and removes nullbyte',
    },
  ],
  untouched: 42,
})

let seed = 0x5eed1234
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

const charPool = [
  'a',
  'Z',
  ' ',
  '\n',
  '\r',
  '\t',
  '\\',
  '"',
  '✅',
  '😄',
  '“',
  '”',
  '\u0000',
  String.fromCharCode(0xd83d),
  String.fromCharCode(0xde00),
  String.raw`\u0000`,
  String.raw`\uD83D`,
]

function hasDatabaseUnsafeUnicode(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code === 0) return true
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1
        continue
      }
      return true
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

const fuzzRuns = 5000
for (let i = 0; i < fuzzRuns; i += 1) {
  let input = ''
  const length = 1 + Math.floor(random() * 80)
  for (let j = 0; j < length; j += 1) {
    input += charPool[Math.floor(random() * charPool.length)]
  }

  const output = sanitizeDatabaseText(input)
  assert.equal(hasDatabaseUnsafeUnicode(output), false, `fuzz case ${i} still contains unsafe Unicode`)
  assert.doesNotThrow(() => JSON.stringify({ content: output }), `fuzz case ${i} must JSON stringify`)
}

console.log(`Passed ${cases.length + 1 + fuzzRuns} database text sanitizer stress cases`)
