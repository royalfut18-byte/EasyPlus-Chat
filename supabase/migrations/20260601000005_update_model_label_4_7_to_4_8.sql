-- Update browser-visible model labels from Claude Opus 4.7 to Claude Opus 4.8
-- Only updates rows that currently have the old public model ID
-- Does NOT affect internal backend routing or provider names

UPDATE public.conversations
SET model_used = 'claude-opus-4.8'
WHERE model_used = 'claude-opus-4.7';

UPDATE public.messages
SET model = 'claude-opus-4.8'
WHERE model = 'claude-opus-4.7';
