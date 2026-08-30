-- Reactions attach to a "target" identified by type + id, so one table
-- serves announcements, birthdays, and (later) messages without separate
-- systems. A user can react once per emoji per target (the unique index),
-- and toggling removes it.

CREATE TABLE reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('announcement', 'birthday')),
    target_id TEXT NOT NULL,  -- announcement uuid, or the user id for a birthday
    emoji TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_type, target_id, emoji, user_id)
);

CREATE INDEX idx_reactions_target ON reactions(target_type, target_id);
