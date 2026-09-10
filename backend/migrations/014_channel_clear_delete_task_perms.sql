-- Three independent, additive changes - each can be reasoned about (and
-- if ever needed, reverted) on its own.

-- 1. "Clear channel" (personal, keeps membership) - hides the channel
--    from just this person's sidebar and hides history before this
--    point in THEIR view only. A new message after this point makes it
--    reappear naturally, and they can keep posting the whole time -
--    genuinely different from Leave, which removes membership entirely.
ALTER TABLE channel_members ADD COLUMN cleared_at TIMESTAMPTZ;

-- 2. Real channel deletion (creator or admin, affects everyone). Soft
--    delete, same philosophy as individual message deletion already in
--    this app: hidden from every listing and from being opened, but the
--    underlying messages stay in the database rather than being erased.
ALTER TABLE channels ADD COLUMN deleted_at TIMESTAMPTZ;

-- 3. Lets an admin grant specific employees the ability to assign tasks
--    to candidates, without making them a department_admin or full
--    admin - a narrow, single-purpose permission rather than a new role.
ALTER TABLE users ADD COLUMN can_assign_candidate_tasks BOOLEAN NOT NULL DEFAULT false;
