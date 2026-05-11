import { AI_MODELS, type ChatMessage } from '@/types/models'

/**
 * Convert data URL to Bedrock Converse image format
 * Bedrock expects: { format, bytes } not Anthropic's { type, source }
 */
function dataUrlToBedrockImage(dataUrl: string, mimeType?: string): { format: string; bytes: string } {
  // Validate data URL format
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('Invalid image data URL: must start with data:image/')
  }

  if (!dataUrl.includes('base64,')) {
    throw new Error('Invalid image data URL: must contain base64 data')
  }

  // Extract mime type and base64 data
  const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!base64Match) {
    throw new Error('Invalid image data URL format')
  }

  const extractedMimeType = base64Match[1]
  const base64Data = base64Match[2]

  if (!base64Data) {
    throw new Error('Invalid image data URL: no base64 data found')
  }

  // Map mime type to Bedrock format
  const finalMimeType = mimeType || extractedMimeType
  let format: string

  switch (finalMimeType.toLowerCase()) {
    case 'image/png':
      format = 'png'
      break
    case 'image/jpeg':
    case 'image/jpg':
      format = 'jpeg'
      break
    case 'image/webp':
      format = 'webp'
      break
    default:
      throw new Error('Unsupported image type. Please use PNG, JPEG, or WebP.')
  }

  return {
    format,
    bytes: base64Data,
  }
}

export async function streamBedrockResponse(
  modelId: string,
  messages: ChatMessage[],
  artifactMode: boolean = false
): Promise<ReadableStream> {
  const model = AI_MODELS.find((m) => m.id === modelId)

  if (!model) {
    console.error('[Bedrock] Unknown model ID:', modelId)
    throw new Error(`Unknown model: ${modelId}`)
  }

  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK
  const region = process.env.AWS_REGION || 'ap-southeast-2'

  if (!apiKey) {
    console.error('[Bedrock] FATAL: AWS_BEARER_TOKEN_BEDROCK is not set')
    throw new Error('Missing AWS_BEARER_TOKEN_BEDROCK')
  }

  const bedrockMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const content: any[] = []

      // Add images if present (Bedrock Converse format)
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image' && attachment.dataUrl) {
            try {
              const { format, bytes } = dataUrlToBedrockImage(attachment.dataUrl, attachment.mimeType)

              // Bedrock Converse format: { image: { format, source: { bytes } } }
              content.push({
                image: {
                  format,
                  source: {
                    bytes,
                  },
                },
              })

              if (process.env.NODE_ENV !== 'production') {
                console.log('[Bedrock] Added image:', {
                  hasImage: true,
                  format,
                  bytesLength: bytes.substring(0, 50) + '...',
                })
              }
            } catch (error: any) {
              console.error('[Bedrock] Failed to process image:', error.message)
              throw new Error(`Image processing failed: ${error.message}`)
            }
          }
        }
      }

      // Add text content
      if (message.content && message.content.trim()) {
        content.push({ text: message.content })
      }

      // If we have images but no text, add a default prompt
      if (content.length > 0 && content.some(c => c.image) && !message.content) {
        content.push({ text: 'Please analyze this image.' })
      }

      // Ensure we always have at least one content item
      if (content.length === 0) {
        content.push({ text: message.content || '' })
      }

      return {
        role: message.role,
        content,
      }
    })

  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${model.bedrockModelId}/converse`

  // Build system prompt with model identity and optional artifact instructions
  // Special handling for Chat GPT 5.5 (Claude Haiku 4.5 disguised as OpenAI)
  const providerName = model.id === 'claude-haiku-4.5' ? 'OpenAI' : 'Anthropic'

  let systemPromptText = `You are ${model.name}, powered by ${providerName}. You are a helpful and knowledgeable assistant. You maintain conversation context and understand follow-up questions by referring to previous messages in the conversation.

IMPORTANT MODEL IDENTITY:
- If the user asks "what model are you", "which model", "what gemini", "what claude", or similar questions, you MUST answer: "I'm ${model.name}, powered by ${providerName}."
- Do not claim to be a different model or provider.
- Be accurate about your model identity.`

  // Add artifact mode instructions if enabled
  if (artifactMode) {
    systemPromptText += `

ARTIFACT MODE IS ENABLED - PREMIUM QUALITY REQUIRED:
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

QUALITY SELF-CHECK BEFORE RETURNING:
Before finalizing the artifact, verify:
1. Does it look visually polished?
2. Is it responsive?
3. Does it have enough styling?
4. Is it interactive if requested?
5. Would this look embarrassing in a product demo?
If it looks basic, improve it before returning the artifact.

Always strive for premium, polished, production-quality artifacts with modern design and smooth interactions."`
  }

  const systemPrompt = [
    {
      text: systemPromptText,
    },
  ]

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: bedrockMessages,
      system: systemPrompt,
      inferenceConfig: {
        maxTokens: 16384,
        temperature: 0.7,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Bedrock] API error:', {
      status: response.status,
      modelId: model.id,
      error: errorText.substring(0, 200),
    })

    throw new Error(
      `Bedrock API failed (${response.status}): ${errorText.substring(0, 200)}`
    )
  }

  const data = await response.json()

  const text =
    data?.output?.message?.content
      ?.map((part: { text?: string }) => part.text || '')
      .join('') || ''

  if (!text) {
    console.warn('[Bedrock] Empty response from API')
  }

  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

export function getModelCost(modelId: string): number {
  const model = AI_MODELS.find((m) => m.id === modelId)
  return model?.costPerMessage || 0
}
