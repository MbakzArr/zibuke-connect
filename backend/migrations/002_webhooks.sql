-- Webhook tokens let external systems post into a channel without a user
-- login. Each token is scoped to one channel and carries a label so you
-- know what created it. The secret is stored hashed, never in plaintext.

CREATE TABLE webhook_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_tokens_channel ON webhook_tokens(channel_id);
