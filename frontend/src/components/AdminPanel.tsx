import { useEffect, useState } from 'react';
import {
  adminApi, type AdminUser,
  departmentsApi, type Department,
  webhooksApi, type Webhook,
  channelsApi, type BrowsableChannel,
} from '../api/resources';
import { colorFor } from '../util/avatarColor';
import { useToast } from '../context/ToastContext';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  department_admin: 'Dept admin',
  employee: 'Employee',
};

type Tab = 'employees' | 'departments' | 'webhooks';

// Admin-only control center: employees, departments, and webhooks, each in
// their own tab. Every one of these had a fully-built backend already;
// this panel is what actually makes them usable instead of curl-only.
export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('employees');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>⚙ Admin</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="admin-tabs">
          <button className={`admin-tab ${tab === 'employees' ? 'is-active' : ''}`} onClick={() => setTab('employees')}>
            👤 Employees
          </button>
          <button className={`admin-tab ${tab === 'departments' ? 'is-active' : ''}`} onClick={() => setTab('departments')}>
            🏢 Departments
          </button>
          <button className={`admin-tab ${tab === 'webhooks' ? 'is-active' : ''}`} onClick={() => setTab('webhooks')}>
            🔌 Webhooks
          </button>
        </div>

        <div className="admin-panel-body">
          {tab === 'employees' && <EmployeesTab />}
          {tab === 'departments' && <DepartmentsTab />}
          {tab === 'webhooks' && <WebhooksTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Employees

function EmployeesTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const [{ users }, { departments }] = await Promise.all([
        adminApi.listUsers(),
        departmentsApi.list(),
      ]);
      setUsers(users);
      setDepartments(departments);
    } catch {
      setError('Could not load employees.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRemove(u: AdminUser) {
    if (!window.confirm(`Remove ${u.full_name || u.email}? They won't be able to log in, and will disappear from the directory. This can be undone.`)) {
      return;
    }
    setBusyId(u.id);
    try {
      await adminApi.removeEmployee(u.id);
      await load();
      showToast(`${u.full_name || u.email} removed.`, { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not remove employee.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(u: AdminUser) {
    setBusyId(u.id);
    try {
      await adminApi.restoreEmployee(u.id);
      await load();
      showToast(`${u.full_name || u.email} restored.`, { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not restore employee.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRoleChange(u: AdminUser, role: string) {
    setBusyId(u.id);
    try {
      await adminApi.setRole(u.id, role);
      await load();
      showToast(`Role updated.`, { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not update role.', { type: 'error' });
      await load(); // the <select> may have visually changed - snap it back to the real value
    } finally {
      setBusyId(null);
    }
  }

  async function handleDepartmentChange(u: AdminUser, departmentId: string) {
    setBusyId(u.id);
    try {
      await adminApi.setDepartment(u.id, departmentId || null);
      await load();
      showToast('Department updated.', { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not update department.', { type: 'error' });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetPassword(u: AdminUser) {
    // window.prompt, not a modal - this is a rare, admin-only, one-off
    // action (matches how confirm() is used elsewhere in the panel), not
    // worth a dedicated dialog component.
    const newPassword = window.prompt(`New temporary password for ${u.full_name || u.email} (at least 8 characters):`);
    if (!newPassword) return; // cancelled
    if (newPassword.length < 8) {
      showToast('Password must be at least 8 characters.', { type: 'error' });
      return;
    }
    setBusyId(u.id);
    try {
      await adminApi.resetPassword(u.id, newPassword);
      showToast(`Password reset for ${u.full_name || u.email}. Share it with them directly.`, { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not reset password.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="admin-panel-toolbar">
        <span className="hub-muted">{users.filter((u) => !u.deleted_at).length} active</span>
        <button className="hub-post-btn" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add employee'}
        </button>
      </div>

      {showAdd && <AddEmployeeForm departments={departments} onAdded={() => { setShowAdd(false); load(); }} />}

      {error && <p className="hub-error" role="alert">{error}</p>}
      {loading ? (
        <p className="hub-muted">Loading...</p>
      ) : (
        <ul className="admin-user-list">
          {users.map((u) => (
            <li key={u.id} className={`admin-user-row ${u.deleted_at ? 'is-removed' : ''}`}>
              <span className="hub-avatar" style={{ background: colorFor(u.id) }}>
                {(u.full_name || '?').charAt(0).toUpperCase()}
              </span>
              <span className="admin-user-info">
                <span className="admin-user-name">
                  {u.full_name || u.email}
                  {u.deleted_at && <span className="admin-user-removed-tag">Removed</span>}
                </span>
                <span className="admin-user-meta">
                  {u.email}{u.job_title ? ` · ${u.job_title}` : ''}
                </span>
              </span>
              {!u.deleted_at && (
                <>
                  <select
                    className="admin-role-select"
                    value={u.department_id || ''}
                    disabled={busyId === u.id}
                    title="Department"
                    onChange={(e) => handleDepartmentChange(u, e.target.value)}
                  >
                    <option value="">No department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <select
                    className="admin-role-select"
                    value={u.role}
                    disabled={busyId === u.id}
                    title="Role"
                    onChange={(e) => handleRoleChange(u, e.target.value)}
                  >
                    {Object.entries(ROLE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </>
              )}
              {u.deleted_at ? (
                <button className="admin-restore-btn" disabled={busyId === u.id} onClick={() => handleRestore(u)}>
                  Restore
                </button>
              ) : (
                <>
                  <button className="admin-reset-btn" disabled={busyId === u.id} onClick={() => handleResetPassword(u)} title="Reset their password">
                    🔑
                  </button>
                  <button className="admin-remove-btn" disabled={busyId === u.id} onClick={() => handleRemove(u)}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
          {users.length === 0 && <li className="hub-muted">No employees yet.</li>}
        </ul>
      )}
    </>
  );
}

function AddEmployeeForm({ departments, onAdded }: { departments: Department[]; onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState('employee');
  const [departmentId, setDepartmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function submit() {
    if (!email.trim() || !password.trim() || !fullName.trim()) {
      setError('Name, email and password are all required.');
      return;
    }
    if (password.trim().length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.createEmployee({
        email: email.trim(),
        password: password.trim(),
        fullName: fullName.trim(),
        jobTitle: jobTitle.trim() || undefined,
        role,
        departmentId: departmentId || null,
      });
      showToast(`${fullName.trim()} added.`, { type: 'success' });
      onAdded();
    } catch (err: any) {
      setError(err?.message || 'Could not add employee.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-add-form">
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Temporary password" type="text" />
      <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Job title (optional)" />
      <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
        <option value="">No department (set later)</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="employee">Employee</option>
        <option value="department_admin">Dept admin</option>
        <option value="admin">Admin</option>
      </select>
      {error && <p className="hub-error" role="alert">{error}</p>}
      <div className="hub-post-actions">
        <button className="hub-post-send" onClick={submit} disabled={busy}>
          {busy ? 'Adding...' : 'Add employee'}
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Departments

function DepartmentsTab() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const [{ departments }, { users }] = await Promise.all([
        departmentsApi.list(),
        adminApi.listUsers(),
      ]);
      setDepartments(departments);
      setPeople(users.filter((u) => !u.deleted_at));
    } catch {
      showToast('Could not load departments.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleHeadChange(dept: Department, headUserId: string) {
    setBusyId(dept.id);
    try {
      await departmentsApi.update(dept.id, undefined, headUserId || null);
      await load();
      showToast('Department head updated.', { type: 'success' });

      // Head is just a label, department_admin is the actual permission
      // (e.g. to post announcements for the department) - those are
      // deliberately kept separate, but it's easy to name a head and
      // forget the role never followed. Nudge, don't force.
      const newHead = headUserId ? people.find((p) => p.id === headUserId) : null;
      if (newHead && newHead.role === 'employee') {
        showToast(`${newHead.full_name || newHead.email} is still an Employee - make them Dept admin too?`, {
          type: 'info',
          durationMs: 10000,
          action: {
            label: 'Promote',
            onClick: async () => {
              try {
                await adminApi.setRole(newHead.id, 'department_admin');
                await load();
                showToast(`${newHead.full_name || newHead.email} is now a Dept admin.`, { type: 'success' });
              } catch (err: any) {
                showToast(err?.message || 'Could not update their role.', { type: 'error' });
              }
            },
          },
        });
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not update department head.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(dept: Department) {
    if (!window.confirm(`Delete the "${dept.name}" department? This doesn't remove anyone from the company, just the grouping.`)) {
      return;
    }
    setBusyId(dept.id);
    try {
      await departmentsApi.remove(dept.id);
      await load();
      showToast(`"${dept.name}" deleted.`, { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not delete department.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="admin-panel-toolbar">
        <span className="hub-muted">{departments.length} department{departments.length === 1 ? '' : 's'}</span>
        <button className="hub-post-btn" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add department'}
        </button>
      </div>

      {showAdd && <AddDepartmentForm people={people} onAdded={() => { setShowAdd(false); load(); }} />}

      {loading ? (
        <p className="hub-muted">Loading...</p>
      ) : (
        <ul className="admin-user-list">
          {departments.map((d) => (
            <li key={d.id} className="admin-user-row">
              <span className="admin-dept-icon">🏢</span>
              <span className="admin-user-info">
                <span className="admin-user-name">{d.name}</span>
                <span className="admin-user-meta">{d.head_name ? `Head: ${d.head_name}` : 'No head assigned'}</span>
              </span>
              <select
                className="admin-role-select"
                value={d.head_user_id || ''}
                disabled={busyId === d.id}
                onChange={(e) => handleHeadChange(d, e.target.value)}
              >
                <option value="">No head</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                ))}
              </select>
              <button className="admin-remove-btn" disabled={busyId === d.id} onClick={() => handleDelete(d)}>
                Delete
              </button>
            </li>
          ))}
          {departments.length === 0 && <li className="hub-muted">No departments yet.</li>}
        </ul>
      )}
    </>
  );
}

function AddDepartmentForm({ people, onAdded }: { people: AdminUser[]; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [headUserId, setHeadUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function submit() {
    if (!name.trim()) {
      setError('Department name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await departmentsApi.create(name.trim(), headUserId || undefined);
      showToast(`"${name.trim()}" created.`, { type: 'success' });
      onAdded();
    } catch (err: any) {
      setError(err?.message || 'Could not create department.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-add-form">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Department name" />
      <select value={headUserId} onChange={(e) => setHeadUserId(e.target.value)}>
        <option value="">No head (set later)</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
        ))}
      </select>
      {error && <p className="hub-error" role="alert">{error}</p>}
      <div className="hub-post-actions">
        <button className="hub-post-send" onClick={submit} disabled={busy}>
          {busy ? 'Adding...' : 'Add department'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Webhooks

function WebhooksTab() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [channels, setChannels] = useState<BrowsableChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The raw token is only ever returned once, at creation - shown here
  // until the admin dismisses it, then it's gone from memory for good.
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);
  const { showToast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const [{ webhooks }, { channels }] = await Promise.all([
        webhooksApi.list(),
        channelsApi.browse(),
      ]);
      setWebhooks(webhooks);
      setChannels(channels);
    } catch {
      showToast('Could not load webhooks.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(w: Webhook) {
    if (!window.confirm(`Delete the "${w.label}" webhook? Anything still using its token will stop working immediately.`)) {
      return;
    }
    setBusyId(w.id);
    try {
      await webhooksApi.remove(w.id);
      await load();
      showToast(`"${w.label}" deleted.`, { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not delete webhook.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p className="hub-muted admin-webhook-intro">
        Lets an external system (CI, HR, monitoring) post into a channel with a secret token instead of a user account.
      </p>
      <div className="admin-panel-toolbar">
        <span className="hub-muted">{webhooks.length} webhook{webhooks.length === 1 ? '' : 's'}</span>
        <button className="hub-post-btn" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add webhook'}
        </button>
      </div>

      {showAdd && (
        <AddWebhookForm
          channels={channels}
          onAdded={(token) => {
            setShowAdd(false);
            setJustCreatedToken(token);
            load();
          }}
        />
      )}

      {justCreatedToken && (
        <div className="admin-token-reveal">
          <p><strong>Copy this token now</strong> - it won't be shown again.</p>
          <code className="admin-token-value">{justCreatedToken}</code>
          <button className="hub-post-cancel" onClick={() => setJustCreatedToken(null)}>Done, I've copied it</button>
        </div>
      )}

      {loading ? (
        <p className="hub-muted">Loading...</p>
      ) : (
        <ul className="admin-user-list">
          {webhooks.map((w) => (
            <li key={w.id} className="admin-user-row">
              <span className="admin-dept-icon">🔌</span>
              <span className="admin-user-info">
                <span className="admin-user-name">{w.label}</span>
                <span className="admin-user-meta">
                  #{w.channel_name} · {w.last_used_at ? `last used ${new Date(w.last_used_at).toLocaleDateString()}` : 'never used'}
                </span>
              </span>
              <button className="admin-remove-btn" disabled={busyId === w.id} onClick={() => handleDelete(w)}>
                Delete
              </button>
            </li>
          ))}
          {webhooks.length === 0 && <li className="hub-muted">No webhooks yet.</li>}
        </ul>
      )}
    </>
  );
}

function AddWebhookForm({ channels, onAdded }: { channels: BrowsableChannel[]; onAdded: (token: string) => void }) {
  const [channelId, setChannelId] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!channelId || !label.trim()) {
      setError('Pick a channel and give the webhook a label.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { token } = await webhooksApi.create(channelId, label.trim());
      onAdded(token);
    } catch (err: any) {
      setError(err?.message || 'Could not create webhook.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-add-form">
      <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
        <option value="">Choose a channel...</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>#{c.name}</option>
        ))}
      </select>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. CI pipeline)" />
      {error && <p className="hub-error" role="alert">{error}</p>}
      <div className="hub-post-actions">
        <button className="hub-post-send" onClick={submit} disabled={busy}>
          {busy ? 'Creating...' : 'Create webhook'}
        </button>
      </div>
    </div>
  );
}
