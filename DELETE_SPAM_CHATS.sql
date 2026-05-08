-- Delete all conversations and messages
-- Run this in Supabase SQL Editor to clean up the spam

-- First delete all messages (because of foreign key constraint)
DELETE FROM messages;

-- Then delete all conversations
DELETE FROM conversations;

-- Verify they're gone
SELECT COUNT(*) as remaining_conversations FROM conversations;
SELECT COUNT(*) as remaining_messages FROM messages;
