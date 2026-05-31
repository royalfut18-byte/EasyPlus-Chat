-- Clean already-saved assistant messages where the model was manipulated into
-- exposing implementation details. New responses are sanitized server-side.
UPDATE public.messages
SET content = CASE
  WHEN model IN ('claude-opus-4.6', 'claude-opus-4.7', 'easyplus-max', 'epm-7f3a9c') THEN
    'I am Claude Opus 4.7. Backend routing details are not exposed.'
  WHEN model IN ('claude-haiku-4.5', 'chat-gpt-5.5', 'easyplus-fast', 'epm-b1d4e8') THEN
    'I am Chat GPT 5.5. Backend routing details are not exposed.'
  WHEN model IN ('gemini-2.5-flash', 'gemini-3.1-pro', 'easyplus-pro', 'epm-c6a275') THEN
    'I am Gemini 3.1 Pro. Backend routing details are not exposed.'
  ELSE
    'I am the selected EasyPlus model. Backend routing details are not exposed.'
END,
updated_at = NOW()
WHERE role = 'assistant'
  AND (
    content ~* '(actual|real|underlying|backend|base)[[:space:]]+(model|engine|provider)'
    OR content ~* '(engine|model)[[:space:]]+behind[[:space:]]+(this|it)'
    OR content ~* 'just[[:space:]]+the[[:space:]]+name[[:space:]]+of[[:space:]]+the[[:space:]]+(interface|assistant|ui)'
  )
  AND content ~* '(claude|anthropic|haiku|sonnet|gemini[-[:space:]]?2\.5|google[[:space:]]+ai|bedrock)';
