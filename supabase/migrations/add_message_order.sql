-- Add order_index column for stable message ordering
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS order_index BIGINT;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_messages_conversation_order
ON public.messages(conversation_id, order_index);

-- Backfill existing messages with order_index based on created_at and role priority
-- User messages must come before assistant messages when created_at is same/close
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id
      ORDER BY
        created_at ASC,
        CASE
          WHEN role = 'user' THEN 0
          WHEN role = 'assistant' THEN 1
          ELSE 2
        END ASC,
        id ASC
    ) AS rn
  FROM public.messages
)
UPDATE public.messages m
SET order_index = ordered.rn
FROM ordered
WHERE m.id = ordered.id
  AND m.order_index IS NULL;
