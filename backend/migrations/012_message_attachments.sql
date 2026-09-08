-- File attachments on messages. One attachment per message for now (keeps
-- the schema and the UI simple) - the object itself lives in Cloudflare R2,
-- not in Postgres; these columns are just the pointer and display metadata.
-- All nullable since most messages have no attachment at all.

ALTER TABLE messages ADD COLUMN attachment_key TEXT;
ALTER TABLE messages ADD COLUMN attachment_name TEXT;
ALTER TABLE messages ADD COLUMN attachment_type TEXT;
ALTER TABLE messages ADD COLUMN attachment_size INTEGER;
