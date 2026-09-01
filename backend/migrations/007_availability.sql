-- A manually-set availability status, separate from actual connection
-- presence (which is driven by socket connect/disconnect and lives in
-- users.status: 'online'/'offline'). This adds a real, honest layer on top:
-- when you're connected, you can say whether you're Available, Busy, or
-- Away. There is deliberately no manually-selectable "Offline" here - that
-- would mean showing yourself as offline while still actively connected,
-- which is misleading. True offline is what happens when you disconnect.

ALTER TABLE users ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'busy', 'away'));
