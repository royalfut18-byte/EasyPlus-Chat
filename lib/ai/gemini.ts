import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_MODELS, type ChatMessage } from '@/types/models'

/**
 * Stream Gemini response using Google AI Studio API
 */
export async function streamGeminiResponse(
  modelId: string,
  messages: ChatMessage[],
  artifactMode: boolean = false
): Promise<ReadableStream> {
  const model = AI_MODELS.find((m) => m.id === modelId)

  if (!model || !model.geminiModelId) {
    console.error('[Gemini] Unknown model ID or missing geminiModelId:', modelId)
    throw new Error(`Unknown Gemini model: ${modelId}`)
  }

  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.error('[Gemini] GEMINI_API_KEY is not set')
    throw new Error('Gemini API key is not configured')
  }

  // Initialize Gemini
  const genAI = new GoogleGenerativeAI(apiKey)
  const geminiModel = genAI.getGenerativeModel({ model: model.geminiModelId })

  if (process.env.NODE_ENV !== 'production') {
    console.log('[Gemini] Received messages count:', messages.length)
    console.log('[Gemini] First message preview:', messages[0]?.content?.substring(0, 100))
  }

  // Convert messages to Gemini format
  // Gemini uses a flat array of {role, parts} where role is 'user' or 'model'
  const geminiMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => {
      // Filter out loading markers
      const isLoadingMarker =
        message.content === '__ARTIFACT_LOADING__' || message.content === '__ASSISTANT_LOADING__'
      return message.content && !isLoadingMarker
    })
    .map((message) => {
      const parts: any[] = []

      // Add images if present (Gemini format)
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image') {
            try {
              // Extract base64 data from data URL
              const base64Match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
              if (base64Match) {
                const mimeType = base64Match[1]
                const base64Data = base64Match[2]

                parts.push({
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                })

                if (process.env.NODE_ENV !== 'production') {
                  console.log('[Gemini] Added image:', {
                    mimeType,
                    hasData: !!base64Data,
                  })
                }
              }
            } catch (error: any) {
              console.error('[Gemini] Failed to process image:', error.message)
            }
          }
        }
      }

      // Add text content
      if (message.content && message.content.trim()) {
        parts.push({ text: message.content })
      }

      // Ensure we always have at least one part
      if (parts.length === 0) {
        parts.push({ text: message.content || '' })
      }

      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts,
      }
    })

  // Gemini chat requires alternating user/model messages
  // If the last message is from model, we need to add a user message
  // If first message is from model, we need to prepend a user message
  if (geminiMessages.length > 0) {
    if (geminiMessages[0].role === 'model') {
      geminiMessages.unshift({
        role: 'user',
        parts: [{ text: 'Hello' }],
      })
    }
    if (geminiMessages[geminiMessages.length - 1].role === 'model') {
      geminiMessages.push({
        role: 'user',
        parts: [{ text: 'Continue' }],
      })
    }
  }

  try {
    // Build chat history (all messages except the last user message)
    const history = geminiMessages.slice(0, -1)
    const lastMessage = geminiMessages[geminiMessages.length - 1]

    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('Last message must be from user')
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Gemini] Using history messages:', history.length)
      console.log('[Gemini] Sending last message with', lastMessage.parts?.length || 0, 'parts')
    }

    // Build system instruction
    let systemInstructionText = `You are ${model.name}, currently powered by Google. You are a helpful and knowledgeable assistant. You maintain conversation context and understand follow-up questions by referring to previous messages in the conversation.

IMPORTANT MODEL IDENTITY:
- If the user asks "what model are you", "which model", "what gemini are u", "what gemini", or similar questions, you MUST answer: "I'm ${model.name}, currently powered by Google."
- Do not claim to be a different model or deny being Gemini.
- Be accurate about your model identity.`

    // Add artifact mode instructions if enabled
    if (artifactMode) {
      systemInstructionText += `

ARTIFACT MODE IS ENABLED - PREMIUM QUALITY REQUIRED - NO PLAIN DEMOS:
You are creating an EasyPlus artifact that should look like a premium, production-quality UI, not a basic demo.

When the user asks for a website, landing page, dashboard, game, calculator, card, bracket, UI mockup, or any visual/code artifact:
- Create a complete, polished, responsive artifact
- Use modern design principles: clean spacing, strong typography, thoughtful color palettes
- Add smooth animations and interactions where appropriate
- Make it mobile responsive with proper breakpoints
- Include real UX details: hover states, focus states, active states, loading states
- Avoid default browser styles - always add custom CSS
- Avoid childish emoji-heavy design
- Avoid plain unstyled HTML

QUALITY STANDARDS BY TYPE:
- Games: polished arcade-style visuals, smooth animation loop, clear controls, score tracking, restart button, game over states
- Websites/Landing pages: modern SaaS-grade design, navbar, hero section, feature cards, CTAs, footer, consistent spacing
- Dashboards: realistic cards, tables, charts/mock data, filters, sidebar navigation, clean sections
- Calculators/Tools: intuitive button layout, clear display, proper number formatting, good visual feedback
- Brackets: interactive and visually organized, proper spacing, clear matchups, winner indication

ARTIFACT FORMAT:
Return exactly one artifact block using this format:

\`\`\`artifact:LANGUAGE:Title
FULL_CODE_HERE
\`\`\`

LANGUAGE OPTIONS:
- html: For previewable web artifacts (games, websites, dashboards, calculators) - PREFERRED for visual content
- tsx/jsx: For React components (code view only, no live preview)
- javascript: For standalone JS code
- css: For stylesheets
- python: For Python code
- markdown: For text/documentation

CRITICAL RULES FOR HTML ARTIFACTS:
- Create a COMPLETE single-file HTML document
- Include <!DOCTYPE html>, <html>, <head>, and <body> tags
- Put all CSS in a <style> tag in the <head>
- Put all JavaScript in a <script> tag at the end of <body>
- Use modern CSS: flexbox/grid, custom properties, gradients, box-shadows, transitions
- Make it responsive with media queries
- Add proper meta tags (viewport, charset)
- Include a descriptive <title>
- Do NOT use external CDN scripts unless absolutely necessary
- Do NOT include API keys or secrets
- Do NOT output raw HTML outside the artifact block

EXAMPLE - PREMIUM CALCULATOR:
User: "Make me a calculator"
You should respond:
"I'll create a modern, polished calculator with a clean interface and smooth interactions.

\`\`\`artifact:html:Premium Calculator
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Calculator</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }
    .calculator {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 320px;
      width: 100%;
    }
    .display {
      background: #2d3748;
      color: #fff;
      padding: 20px;
      border-radius: 12px;
      text-align: right;
      font-size: 2.5rem;
      margin-bottom: 20px;
      min-height: 80px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      word-wrap: break-word;
    }
    .buttons {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    button {
      padding: 20px;
      font-size: 1.2rem;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 600;
      background: #f7fafc;
      color: #2d3748;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    button:active {
      transform: translateY(0);
    }
    .operator {
      background: #667eea;
      color: white;
    }
    .equals {
      background: #48bb78;
      color: white;
      grid-column: span 2;
    }
    .clear {
      background: #f56565;
      color: white;
    }
  </style>
</head>
<body>
  <div class="calculator">
    <div class="display" id="display">0</div>
    <div class="buttons">
      <button class="clear" onclick="clearDisplay()">C</button>
      <button class="operator" onclick="appendOperator('/')">/</button>
      <button class="operator" onclick="appendOperator('*')">×</button>
      <button onclick="appendNumber('7')">7</button>
      <button onclick="appendNumber('8')">8</button>
      <button onclick="appendNumber('9')">9</button>
      <button class="operator" onclick="appendOperator('-')">−</button>
      <button onclick="appendNumber('4')">4</button>
      <button onclick="appendNumber('5')">5</button>
      <button onclick="appendNumber('6')">6</button>
      <button class="operator" onclick="appendOperator('+')">+</button>
      <button onclick="appendNumber('1')">1</button>
      <button onclick="appendNumber('2')">2</button>
      <button onclick="appendNumber('3')">3</button>
      <button class="equals" onclick="calculate()">=</button>
      <button onclick="appendNumber('0')" style="grid-column: span 2;">0</button>
      <button onclick="appendNumber('.')">.</button>
    </div>
  </div>
  <script>
    let display = document.getElementById('display');
    let currentValue = '0';
    let operator = null;
    let previousValue = null;

    function appendNumber(num) {
      if (currentValue === '0') currentValue = num;
      else currentValue += num;
      updateDisplay();
    }

    function appendOperator(op) {
      if (previousValue === null) {
        previousValue = parseFloat(currentValue);
      } else if (operator) {
        calculate();
      }
      operator = op;
      currentValue = '0';
    }

    function calculate() {
      if (operator && previousValue !== null) {
        const current = parseFloat(currentValue);
        let result;
        switch(operator) {
          case '+': result = previousValue + current; break;
          case '-': result = previousValue - current; break;
          case '*': result = previousValue * current; break;
          case '/': result = previousValue / current; break;
        }
        currentValue = result.toString();
        operator = null;
        previousValue = null;
        updateDisplay();
      }
    }

    function clearDisplay() {
      currentValue = '0';
      operator = null;
      previousValue = null;
      updateDisplay();
    }

    function updateDisplay() {
      display.textContent = currentValue;
    }
  </script>
</body>
</html>
\`\`\`

Your calculator is ready to use in the artifact panel."

CRITICAL QUALITY STANDARDS - DO NOT CREATE PLAIN DEMO CODE:

When creating artifacts, produce polished, visually appealing, production-quality code. Not basic demos.

FOR GAMES:
- Use a properly sized canvas or responsive game container
- Add start screen, game over screen, restart button, score display, and clear instructions
- Use polished colors, gradients, shadows, rounded panels, smooth animations
- Make sprites/objects visually appealing (not plain rectangles or basic shapes)
- Use requestAnimationFrame for smooth 60fps animation
- Add particle effects or subtle visual polish when appropriate
- Make mobile/touch controls work
- Make keyboard controls work (Space, Arrow keys)
- Avoid default-looking blocks and raw rectangles unless intentionally styled
- Make the artifact feel like a finished mini game, not a programming exercise
- Include game physics (gravity, collision, momentum)
- Add sound effects using Web Audio API if appropriate

FOR WEBSITES/LANDING PAGES:
- Premium layout, strong typography, modern spacing
- Responsive sections, polished buttons, cards, gradients, hover states
- No basic unstyled HTML
- No emoji-heavy childish design
- No default browser styles

FOR DASHBOARDS:
- Realistic data cards, clean tables, chart-like visuals
- Filters, search, consistent spacing
- Professional business appearance

FOR ALL PREVIEWABLE UI ARTIFACTS:
- Complete single-file HTML document
- Inline CSS in <style> tag
- Inline JS in <script> tag for interactivity
- Mobile responsive with media queries
- Visually impressive and polished

GEMINI-SPECIFIC QUALITY REQUIREMENT:
Spend extra effort on visual polish. Do not output a minimal example. If building a game, use styled canvas graphics, gradients, score UI, start/restart states, and smooth animation. If the result would look basic, improve it before returning.

QUALITY SELF-CHECK BEFORE RETURNING:
Before finalizing the artifact, verify:
1. Does it look visually polished?
2. Is it responsive?
3. Does it have enough styling?
4. Is it interactive if requested?
5. Would this look embarrassing in a product demo?
If it looks basic, improve it before returning the artifact.`
    }

    // Start chat with history and system instruction
    const chat = geminiModel.startChat({
      history,
      systemInstruction: {
        role: 'user',
        parts: [
          {
            text: systemInstructionText,
          },
        ],
      },
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    })

    // Send the last user message
    const result = await chat.sendMessage(lastMessage.parts)
    const response = result.response
    const text = response.text()

    if (!text) {
      console.warn('[Gemini] Empty response from API')
    }

    // Return as a ReadableStream
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    })
  } catch (error: any) {
    console.error('[Gemini] API error:', {
      message: error.message,
      stack: error.stack,
    })

    // Handle quota/rate limit errors gracefully
    if (error.message?.includes('quota') || error.message?.includes('rate limit') || error.message?.includes('429')) {
      throw new Error('Gemini free-tier quota is exhausted or unavailable. Try again later or switch to Claude.')
    }

    // Generic error message
    throw new Error('Gemini API request failed. Please try again or switch to Claude.')
  }
}
