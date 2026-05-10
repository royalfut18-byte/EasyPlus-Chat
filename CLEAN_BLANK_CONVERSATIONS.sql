-- Clean up blank conversations that have no messages
-- Run this in your Supabase SQL Editor to remove conversations with no messages

-- First, check how many blank conversations exist (optional, for safety)
SELECT COUNT(*) as blank_conversations_count
FROM conversations
WHERE id NOT IN (
  SELECT DISTINCT conversation_id FROM messages
);

-- Delete conversations that have no messages
DELETE FROM conversations
WHERE id NOT IN (
  SELECT DISTINCT conversation_id FROM messages
);

-- Verify cleanup (should return 0 if all blank conversations were removed)
SELECT COUNT(*) as remaining_blank_conversations
FROM conversations
WHERE id NOT IN (
  SELECT DISTINCT conversation_id FROM messages
);
