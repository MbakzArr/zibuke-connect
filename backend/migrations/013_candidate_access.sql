-- Adds a genuine "limited access" tier for assessment candidates, contractors,
-- etc. - built as a user_type orthogonal to role (not a fake department),
-- so all existing role-based permission checks keep working completely
-- unchanged. A candidate is still 'employee' role (can send messages,
-- has their own tasks), just restricted in WHICH channels and
-- announcements they can see at all.
--
-- Every new column defaults to the value that reproduces today's exact
-- behavior for everyone who already exists - 'employee' for user_type,
-- and false for visible_to_candidates (opt-in, not opt-out: nothing
-- becomes visible to a candidate by accident, an admin has to
-- deliberately mark it). Nothing here changes how the app behaves for
-- anyone until a candidate account actually exists.

ALTER TABLE users ADD COLUMN user_type TEXT NOT NULL DEFAULT 'employee'
    CHECK (user_type IN ('employee', 'candidate'));

ALTER TABLE channels ADD COLUMN visible_to_candidates BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE announcements ADD COLUMN visible_to_candidates BOOLEAN NOT NULL DEFAULT false;
