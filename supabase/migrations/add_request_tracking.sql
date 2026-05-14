-- Add request tracking columns for idempotent message handling and recovery
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS request_id TEXT,
ADD COLUMN IF NOT EXISTS client_message_id TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed',
ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

-- Index for fast lookup by request_id (recovery polling)
CREATE INDEX IF NOT EXISTS idx_messages_request_id ON public.messages(request_id) WHERE request_id IS NOT NULL;

-- Index for fast lookup by client_message_id (deduplication)
CREATE INDEX IF NOT EXISTS idx_messages_client_message_id ON public.messages(client_message_id) WHERE client_message_id IS NOT NULL;

-- Index for status-based queries (finding generating messages)
CREATE INDEX IF NOT EXISTS idx_messages_status ON public.messages(status) WHERE status != 'completed';
