-- Public channels used to be instant-join. This adds a request/approve step
-- instead: a row here per request, resolved (approved or rejected) by the
-- channel's creator. Only one PENDING request per person per channel at a
-- time (the partial unique index below) - but a rejected request can be
-- made again later, so history of past requests is kept rather than
-- overwritten.

CREATE TABLE channel_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_channel_join_requests_pending
    ON channel_join_requests (channel_id, user_id)
    WHERE status = 'pending';

CREATE INDEX idx_channel_join_requests_channel ON channel_join_requests(channel_id, status);
