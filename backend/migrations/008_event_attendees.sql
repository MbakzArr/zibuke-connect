-- Adds a venue to events, and a real attendees table so a meeting can
-- invite specific people (not just be visible to everyone). Kept simple:
-- no RSVP status, no recurrence - just "who's invited".

ALTER TABLE events ADD COLUMN venue TEXT;

CREATE TABLE event_attendees (
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
);
