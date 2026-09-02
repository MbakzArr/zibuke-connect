-- Simple task/todo tracking: assign a task to someone, optional due date,
-- optional description, a two-state status (open/done - no "in progress"
-- column, that's tracked informally in conversation, not worth the extra
-- state for a "simple one for demo" tool). due_date is a plain DATE (no
-- time-of-day), matching how it's meant to be used: "due this day", shown
-- as a dot on the same calendar events already use.

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    title TEXT NOT NULL,
    description TEXT,
    assigned_to UUID NOT NULL REFERENCES users(id),
    assigned_by UUID NOT NULL REFERENCES users(id),
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to, status);
CREATE INDEX idx_tasks_assigned_by ON tasks(assigned_by);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
