// Mass test for artifact rendering: ensures interactive figures and other
// artifact outputs are detected AND survive validation as renderable artifacts.
// Regression guard for "the model made an interactive figure but it didn't show".
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

let failures = 0
let passes = 0
function check(condition, message) {
  if (condition) {
    passes += 1
  } else {
    failures += 1
    console.error(`FAIL ${message}`)
  }
}

const sourcePath = 'lib/artifact-parser.ts'
let source = fs.readFileSync(sourcePath, 'utf8')

source = source.replace(
  /import type \{ Artifact \} from '@\/types\/models'\r?\n/,
  `type Artifact = any\n`
)
source = source.replace(
  /import \{ getGeneratedFileLabel, isGeneratedFileArtifactLanguage \} from '@\/lib\/generated-files'\r?\n/,
  `const getGeneratedFileLabel = (kind) => String(kind || '');\nconst isGeneratedFileArtifactLanguage = (kind) => ['pdf', 'pptx', 'gslides', 'docx', 'gdoc', 'xlsx', 'gsheet'].includes(String(kind || ''));\n`
)
source = source.replace(
  /import \{ decodePossiblyEscapedText, parseGeneratedZipFromResponse \} from '@\/lib\/generated-zip'\r?\n/,
  `const decodePossiblyEscapedText = (value) => String(value || '').replace(/\\\\r\\\\n/g, '\\n').replace(/\\\\n/g, '\\n').replace(/\\\\t/g, '\\t');\nconst parseGeneratedZipFromResponse = (content) => ({ cleanContent: content, manifest: null });\n`
)
source = source.replace(
  /import \{ buildArtifactFallback \} from '@\/lib\/artifact-fallback'\r?\n/,
  `const buildArtifactFallback = () => null;\n`
)

const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const moduleRef = { exports: {} }
const context = { module: moduleRef, exports: moduleRef.exports, console, process, setTimeout, clearTimeout }
vm.runInNewContext(transpiled.outputText, context, { filename: sourcePath })
const { parseArtifactFromResponse } = context.module.exports
check(typeof parseArtifactFromResponse === 'function', 'parseArtifactFromResponse exported')

// Helper: assert a response yields a renderable artifact.
function expectRenderable(label, response, { prompt = '', language, mustInclude = [], artifactMode = true } = {}) {
  const { artifact } = parseArtifactFromResponse(response, artifactMode, prompt)
  check(!!artifact, `${label}: artifact detected`)
  if (!artifact) return null
  check(!artifact.validationError, `${label}: no validationError (got: ${artifact.validationError || 'none'})`)
  if (language) check(artifact.language === language, `${label}: language is ${language} (got ${artifact.language})`)
  for (const needle of mustInclude) {
    check(artifact.code.includes(needle), `${label}: code preserves "${needle}"`)
  }
  return artifact
}

// 1. Wrapped interactive canvas game (requestAnimationFrame + addEventListener)
expectRenderable('canvas game (wrapped)', `Here is your game.
<EASYPLUS_ARTIFACT type="html" title="Bounce">
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bounce</title></head>
<body><canvas id="c" width="400" height="300"></canvas>
<script>
const cv=document.getElementById('c');const ctx=cv.getContext('2d');let x=10,vx=2;
function loop(){ctx.clearRect(0,0,400,300);x+=vx;if(x>390||x<0)vx*=-1;ctx.fillRect(x,150,10,10);requestAnimationFrame(loop);}
cv.addEventListener('click',()=>vx*=1.5);loop();
</script></body></html>
</EASYPLUS_ARTIFACT>`, { prompt: 'make an interactive bouncing ball game', language: 'html', mustInclude: ['<canvas', 'requestAnimationFrame'] })

// 2. Fenced ```html interactive quiz with arrow-function handler referenced inline
expectRenderable('quiz (fenced html, arrow handler)', '```html\n' +
`<!DOCTYPE html><html><body>
<div id="q">Question 1</div>
<button onclick="handleAnswer(0)">A</button>
<button onclick="handleAnswer(1)">B</button>
<script>
const handleAnswer = (i) => { document.getElementById('q').textContent = 'Picked ' + i; };
</script></body></html>` + '\n```', { prompt: 'build an interactive quiz', language: 'html', mustInclude: ['handleAnswer'] })

// 3. Raw inline SVG figure (no fence, no doctype)
expectRenderable('raw svg figure', `Here is the figure:
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="tomato"><animate attributeName="r" values="40;20;40" dur="2s" repeatCount="indefinite"/></circle></svg>`,
  { prompt: 'draw an animated svg figure', mustInclude: ['<svg', 'animate'] })

// 4. Fenced ```svg animated chart
expectRenderable('fenced svg chart', '```svg\n' +
`<svg viewBox="0 0 200 100"><rect x="0" y="40" width="40" height="60" fill="#4f46e5"/><rect x="60" y="20" width="40" height="80" fill="#06b6d4"/></svg>` + '\n```',
  { prompt: 'create an svg bar chart', mustInclude: ['<svg', '<rect'] })

// 5. REGRESSION: inline onclick -> arrow function (no parens) previously flagged "missing handler"
expectRenderable('arrow handler no-parens regression', `<!DOCTYPE html><html><body>
<button onclick="toggle()">Toggle</button>
<div id="box">off</div>
<script>const toggle = () => { const b=document.getElementById('box'); b.textContent = b.textContent==='off'?'on':'off'; };</script>
</body></html>`, { prompt: 'interactive toggle widget', language: 'html', mustInclude: ['toggle'] })

// 6. addEventListener-only interactivity (no inline handlers)
expectRenderable('addEventListener only', `<!DOCTYPE html><html><body>
<button id="b">Click</button><p id="out">0</p>
<script>let n=0;document.getElementById('b').addEventListener('click',()=>{n++;document.getElementById('out').textContent=n;});</script>
</body></html>`, { prompt: 'a counter', language: 'html', mustInclude: ['addEventListener'] })

// 7. REGRESSION: very short interactive figure (<600 chars) previously "too short"
expectRenderable('short interactive figure', `<canvas id="c"></canvas><script>const x=document.getElementById('c').getContext('2d');x.fillRect(0,0,50,50);document.querySelector('canvas').onclick=()=>x.clearRect(0,0,99,99);</script>`,
  { prompt: 'tiny interactive canvas', language: 'html', mustInclude: ['<canvas'] })

// 8. External CDN charting library
expectRenderable('external CDN chart', `<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head>
<body><canvas id="chart"></canvas>
<script>new Chart(document.getElementById('chart'),{type:'bar',data:{labels:['a','b'],datasets:[{data:[1,2]}]}});</script>
</body></html>`, { prompt: 'an interactive chart', language: 'html', mustInclude: ['cdn.jsdelivr.net', 'Chart('] })

// 9. Fragment without doctype/html/body -> must be wrapped and renderable
const frag = expectRenderable('fragment wrapped', `<div class="widget"><button onclick="go()">Go</button></div><script>function go(){document.querySelector('.widget').dataset.ran='1';}</script>`,
  { prompt: 'make an interactive widget', language: 'html', mustInclude: ['<button', 'go()'] })
check(!!frag && /<!DOCTYPE html>/i.test(frag.code), 'fragment wrapped: gains a full HTML document wrapper')

// 10. Pure CSS animation figure (no JS at all)
expectRenderable('pure css animation', `<!DOCTYPE html><html><head><style>@keyframes spin{to{transform:rotate(360deg)}}.s{width:40px;height:40px;background:#22c55e;animation:spin 1s linear infinite}</style></head><body><div class="s"></div></body></html>`,
  { prompt: 'a css loading spinner figure', language: 'html', mustInclude: ['@keyframes'] })

// 11. Plain ```javascript figure (d3/canvas style script)
expectRenderable('javascript figure', '```javascript\n' +
`const data=[3,6,2,8];const max=Math.max(...data);data.forEach((d,i)=>{const bar=document.createElement('div');bar.style.height=(d/max*100)+'px';document.body.appendChild(bar);});` + '\n```',
  { prompt: 'build a bar chart in javascript', language: 'javascript' })

// 12. REGRESSION: object-method handler previously flagged "missing handler: next"
expectRenderable('object method handler', `<!DOCTYPE html><html><body>
<button onclick="app.next()">Next</button><div id="s">0</div>
<script>const app={i:0,next(){this.i++;document.getElementById('s').textContent=this.i;}};</script>
</body></html>`, { prompt: 'interactive stepper', language: 'html', mustInclude: ['app.next()'] })

// 13. Good calculator must NOT be replaced by a generic fallback (code preserved)
expectRenderable('calculator not replaced', `<!DOCTYPE html><html><body>
<input id="display" data-marker="USER_CALC_UNIQUE"/>
<button onclick="press('7')">7</button>
<script>const press=(k)=>{document.getElementById('display').value+=k;};</script>
</body></html>`, { prompt: 'make me a calculator', language: 'html', mustInclude: ['USER_CALC_UNIQUE'] })

// 14. Markdown artifact stays renderable
expectRenderable('markdown artifact', '```markdown\n# Title\n\n- one\n- two\n```',
  { prompt: 'write study notes as a document', language: 'markdown', mustInclude: ['# Title'] })

// 15. Interactive timeline (the user-named case)
expectRenderable('interactive timeline', `<!DOCTYPE html><html><body>
<ul id="t"></ul>
<button onclick="add()">Add event</button>
<script>let n=0;function add(){const li=document.createElement('li');li.textContent='Event '+(++n);document.getElementById('t').appendChild(li);}</script>
</body></html>`, { prompt: 'build an interactive timeline', language: 'html', mustInclude: ['<button'] })

// 16. NEGATIVE: genuinely empty artifact should be flagged (correct behavior)
const emptyParse = parseArtifactFromResponse(`<EASYPLUS_ARTIFACT type="html" title="Empty"></EASYPLUS_ARTIFACT>`, true, 'make something')
check(!!emptyParse.artifact && !!emptyParse.artifact.validationError, 'empty artifact: still flagged with validationError')

console.log(`\n${passes} checks passed, ${failures} failed`)
if (failures > 0) {
  console.error('FAIL artifact rendering mass test')
  process.exit(1)
}
console.log('PASS artifact rendering mass test (interactive figures render without false validation failures)')
