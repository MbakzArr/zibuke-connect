-- Real deletion for announcements, mirroring how channels already work:
-- restricted to the original poster or an admin, soft-deleted so the row
-- stays in the database for audit rather than being erased outright.
ALTER TABLE announcements ADD COLUMN deleted_at TIMESTAMPTZ;
