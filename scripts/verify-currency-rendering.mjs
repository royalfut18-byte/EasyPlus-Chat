import fs from 'node:fs'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

const source = fs.readFileSync('lib/ai/format-response.ts', 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
})

const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const { cleanAssistantText } = await import(moduleUrl)

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function renderMarkdown(markdown) {
  const cleaned = cleanAssistantText(markdown)
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, [remarkMath, { singleDollarTextMath: true }]],
      rehypePlugins: [rehypeKatex],
      children: cleaned,
    })
  )

  return { cleaned, html }
}

const exactResponse = [
  'Sally purchased an electronic game machine on hire purchase. She paid $140 deposit and then $25.50 per month for two years.',
  '',
  'The options are:',
  'A. $191',
  'B. $446',
  'C. $612',
  'D. $752',
  '',
  'Working:',
  '$25.50 \u00d7 24 = $612',
  '$140 + $612 = $752',
  '',
  'Answer: D. $752',
].join('\n')

const mixedCurrencyAndMath = 'The cost is $100,000 and the formula is $A = P(1+r)^n$.'
const latexMath = String.raw`Use $u = \sec\theta$ and $$
I = \int_0^{\pi/2} x\,dx
$$.`
const numericInlineMath = 'The widths are $8.8$ m, $7.1$ m, and rainfall was $20$ mm.'
const compactEquationMath = String.raw`Volume uses $241.875 \times 0.02$ and the symbol $A$.`

const exactResult = renderMarkdown(exactResponse)
const mixedResult = renderMarkdown(mixedCurrencyAndMath)
const latexResult = renderMarkdown(latexMath)
const numericResult = renderMarkdown(numericInlineMath)
const compactEquationResult = renderMarkdown(compactEquationMath)

for (const amount of ['$140', '$25.50', '$191', '$446', '$612', '$752']) {
  assert(exactResult.html.includes(amount), `Missing ${amount} in rendered exact response`)
}

assert(!exactResult.html.includes('katex'), 'Currency-only exact response should not invoke KaTeX')
assert(mixedResult.html.includes('$100,000'), 'Missing $100,000 in mixed rendered response')
assert(mixedResult.html.includes('katex'), 'Expected mixed formula to render through KaTeX')
assert(latexResult.html.includes('katex'), 'Expected LaTeX examples to render through KaTeX')
assert(!numericResult.cleaned.includes('\\$8.8\\$'), 'Numeric inline math should not be escaped as literal dollars')
assert(!numericResult.cleaned.includes('\\$20\\$'), 'Unit values should not be escaped as literal dollars')
assert(!numericResult.html.includes('$8.8$'), 'Rendered numeric inline math should not show literal dollar signs')
assert(!numericResult.html.includes('$20$'), 'Rendered unit values should not show literal dollar signs')
assert(numericResult.html.includes('katex'), 'Expected numeric inline math to render through KaTeX')
assert(compactEquationResult.html.includes('katex'), 'Expected compact equation fragments to render through KaTeX')

console.log('PASS exact currency response renders $140, $25.50, $191, $446, $612, $752')
console.log('PASS mixed currency and math renders $100,000 as text and $A = P(1+r)^n$ as KaTeX')
console.log('PASS numeric inline math like $8.8$ m and $20$ mm renders without visible dollar signs')
