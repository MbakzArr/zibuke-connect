import { useEffect, useState } from 'react';
import { adminApi, type AdminUser } from '../api/resources';
import { colorFor } from '../util/avatarColor';
import { useToast } from '../context/ToastContext';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  department_admin: 'Dept admin',
  employee: 'Employee',
};

// Admin-only: list every employee (including removed ones, greyed out),
// add a new one, remove one, or change a role. Kept deliberately simple -
// no bulk actions, no CSV import, just the basics a demo needs.
export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const { users } = await adminApi.listUsers();
      setUsers(users);
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
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>⚙ Manage employees</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="admin-panel-body">
          <div className="admin-panel-toolbar">
            <span className="hub-muted">{users.filter((u) => !u.deleted_at).length} active</span>
            <button className="hub-post-btn" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? 'Cancel' : '+ Add employee'}
            </button>
          </div>

          {showAdd && <AddEmployeeForm onAdded={() => { setShowAdd(false); load(); }} />}

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
                      {u.email}{u.job_title ? ` · ${u.job_title}` : ''}{u.department_name ? ` · ${u.department_name}` : ''}
                    </span>
                  </span>
                  {!u.deleted_at && (
                    <select
                      className="admin-role-select"
                      value={u.role}
                      disabled={busyId === u.id}
                      onChange={(e) => handleRoleChange(u, e.target.value)}
                    >
                      {Object.entries(ROLE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  )}
                  {u.deleted_at ? (
                    <button className="admin-restore-btn" disabled={busyId === u.id} onClick={() => handleRestore(u)}>
                      Restore
                    </button>
                  ) : (
                    <button className="admin-remove-btn" disabled={busyId === u.id} onClick={() => handleRemove(u)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
              {users.length === 0 && <li className="hub-muted">No employees yet.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function AddEmployeeForm({ onAdded }: { onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState('employee');
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
