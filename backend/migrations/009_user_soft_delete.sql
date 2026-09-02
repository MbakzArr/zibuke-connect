-- Removing an employee doesn't hard-delete the users row - their messages
-- (messages.user_id REFERENCES users(id), no ON DELETE) would block that,
-- and deleting the row would also blank out "sender_name" on every message
-- history everywhere. Soft delete instead: stamp deleted_at, keep the row,
-- filter it out of login/directory/birthdays going forward.

ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
