-- Follow-up migration for environments that already applied an earlier
-- public-ID migration. Browser-readable rows should match website model IDs.
UPDATE public.conversations
SET model_used = CASE model_used
  WHEN 'claude-opus-4.6' THEN 'claude-opus-4.8'
  WHEN 'claude-opus-4.7' THEN 'claude-opus-4.8'
  WHEN 'claude-haiku-4.5' THEN 'chat-gpt-5.5'
  WHEN 'gemini-2.5-flash' THEN 'gemini-3.1-pro'
  WHEN 'easyplus-max' THEN 'claude-opus-4.8'
  WHEN 'easyplus-fast' THEN 'chat-gpt-5.5'
  WHEN 'easyplus-pro' THEN 'gemini-3.1-pro'
  WHEN 'epm-7f3a9c' THEN 'claude-opus-4.8'
  WHEN 'epm-b1d4e8' THEN 'chat-gpt-5.5'
  WHEN 'epm-c6a275' THEN 'gemini-3.1-pro'
  ELSE model_used
END
WHERE model_used IN (
  'claude-opus-4.6',
  'claude-opus-4.7',
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
  WHEN 'claude-opus-4.6' THEN 'claude-opus-4.8'
  WHEN 'claude-opus-4.7' THEN 'claude-opus-4.8'
  WHEN 'claude-haiku-4.5' THEN 'chat-gpt-5.5'
  WHEN 'gemini-2.5-flash' THEN 'gemini-3.1-pro'
  WHEN 'easyplus-max' THEN 'claude-opus-4.8'
  WHEN 'easyplus-fast' THEN 'chat-gpt-5.5'
  WHEN 'easyplus-pro' THEN 'gemini-3.1-pro'
  WHEN 'epm-7f3a9c' THEN 'claude-opus-4.8'
  WHEN 'epm-b1d4e8' THEN 'chat-gpt-5.5'
  WHEN 'epm-c6a275' THEN 'gemini-3.1-pro'
  ELSE model
END
WHERE model IN (
  'claude-opus-4.6',
  'claude-opus-4.7',
  'claude-haiku-4.5',
  'gemini-2.5-flash',
  'easyplus-max',
  'easyplus-fast',
  'easyplus-pro',
  'epm-7f3a9c',
  'epm-b1d4e8',
  'epm-c6a275'
);
