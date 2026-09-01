-- Minimal calendar: a title and a start time, org-wide. Kept deliberately
-- simple (no recurrence, invites, or per-attendee tracking) to match the
-- brief's "keep it light" instruction. Powers the hub's "Your Day" card.

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    title TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_org_starts ON events(organization_id, starts_at);
