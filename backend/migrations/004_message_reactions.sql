-- Allow reactions on messages too. The reactions table was built polymorphic
-- (target_type + target_id) from the start; this just widens the CHECK
-- constraint to permit 'message' alongside announcements and birthdays.

ALTER TABLE reactions DROP CONSTRAINT IF EXISTS reactions_target_type_check;
ALTER TABLE reactions ADD CONSTRAINT reactions_target_type_check
    CHECK (target_type IN ('announcement', 'birthday', 'message'));
