-- Keep provider routing private by storing only public website model IDs in
-- browser-readable rows. Server code resolves these IDs to provider models.
UPDATE public.conversations
SET model_used = CASE model_used
  WHEN 'claude-opus-4.6' THEN 'claude-opus-4.7'
  WHEN 'claude-haiku-4.5' THEN 'chat-gpt-5.5'
  WHEN 'gemini-2.5-flash' THEN 'gemini-3.1-pro'
  WHEN 'easyplus-max' THEN 'claude-opus-4.7'
  WHEN 'easyplus-fast' THEN 'chat-gpt-5.5'
  WHEN 'easyplus-pro' THEN 'gemini-3.1-pro'
  WHEN 'epm-7f3a9c' THEN 'claude-opus-4.7'
  WHEN 'epm-b1d4e8' THEN 'chat-gpt-5.5'
  WHEN 'epm-c6a275' THEN 'gemini-3.1-pro'
  ELSE model_used
END
WHERE model_used IN (
  'claude-opus-4.6',
  'claude-haiku-4.5',
  'gemini-2.5-flash',
  'easyplus-max',
  'easyplus-fast',
  'easyplus-pro',
  'epm-7f3a9c',
  'epm-b1d4e8',
  'epm-c6a275'
);

UPDATE public.messages
SET model = CASE model
  WHEN 'claude-opus-4.6' THEN 'claude-opus-4.7'
  WHEN 'claude-haiku-4.5' THEN 'chat-gpt-5.5'
  WHEN 'gemini-2.5-flash' THEN 'gemini-3.1-pro'
  WHEN 'easyplus-max' THEN 'claude-opus-4.7'
  WHEN 'easyplus-fast' THEN 'chat-gpt-5.5'
  WHEN 'easyplus-pro' THEN 'gemini-3.1-pro'
  WHEN 'epm-7f3a9c' THEN 'claude-opus-4.7'
  WHEN 'epm-b1d4e8' THEN 'chat-gpt-5.5'
  WHEN 'epm-c6a275' THEN 'gemini-3.1-pro'
  ELSE model
END
WHERE model IN (
  'claude-opus-4.6',
  'claude-haiku-4.5',
  'gemini-2.5-flash',
  'easyplus-max',
  'easyplus-fast',
  'easyplus-pro',
  'epm-7f3a9c',
  'epm-b1d4e8',
  'epm-c6a275'
);

UPDATE public.credit_transactions
SET description = CASE description
  WHEN 'Message sent using claude-opus-4.6' THEN 'Message sent using Claude Opus 4.7'
  WHEN 'Message sent using claude-haiku-4.5' THEN 'Message sent using Chat GPT 5.5'
  WHEN 'Message sent using gemini-2.5-flash' THEN 'Message sent using Gemini 3.1 Pro'
  WHEN 'Message sent using easyplus-max' THEN 'Message sent using Claude Opus 4.7'
  WHEN 'Message sent using easyplus-fast' THEN 'Message sent using Chat GPT 5.5'
  WHEN 'Message sent using easyplus-pro' THEN 'Message sent using Gemini 3.1 Pro'
  WHEN 'Message sent using epm-7f3a9c' THEN 'Message sent using Claude Opus 4.7'
  WHEN 'Message sent using epm-b1d4e8' THEN 'Message sent using Chat GPT 5.5'
  WHEN 'Message sent using epm-c6a275' THEN 'Message sent using Gemini 3.1 Pro'
  ELSE description
END
WHERE description IN (
  'Message sent using claude-opus-4.6',
  'Message sent using claude-haiku-4.5',
  'Message sent using gemini-2.5-flash',
  'Message sent using easyplus-max',
  'Message sent using easyplus-fast',
  'Message sent using easyplus-pro',
  'Message sent using epm-7f3a9c',
  'Message sent using epm-b1d4e8',
  'Message sent using epm-c6a275'
);
