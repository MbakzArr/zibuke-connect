-- Tracks the last time each user read each channel, so the sidebar can show
-- an unread indicator per channel (not just DMs). One row per user+channel;
-- upserted whenever the user opens that channel.

CREATE TABLE channel_reads (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);
