import { useEffect, useState } from 'react';
import { departmentsApi, directoryApi, type Department } from '../api/resources';
import { useAuth } from '../context/AuthContext';

interface AnnouncementScopePickerProps {
  departmentId: string | null;
  onChange: (departmentId: string | null) => void;
}

// Who an announcement posts to. A full admin can pick "whole org" or any
// department. A department_admin is locked to their own department - the
// backend enforces this regardless (it ignores/rejects anything else), so
// this just makes that visible up front instead of surprising them with a
// 403 after they've written the whole thing.
export default function AnnouncementScopePicker({ departmentId, onChange }: AnnouncementScopePickerProps) {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [ownDepartmentName, setOwnDepartmentName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'admin') {
      departmentsApi.list().then((d) => {
        setDepartments(d.departments);
        setLoaded(true);
      }).catch(() => setLoaded(true));
    } else if (user.role === 'department_admin') {
      directoryApi.profile(user.id).then((d) => {
        onChange(d.profile.department_id ?? null);
        setOwnDepartmentName(d.profile.department_name);
        setLoaded(true);
      }).catch(() => setLoaded(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  if (!loaded) return null;

  if (user?.role === 'department_admin') {
    return (
      <p className="ann-scope-locked">
        {ownDepartmentName
          ? <>Posting to <strong>{ownDepartmentName}</strong> only</>
          : "You're not assigned to a department yet - ask an admin to assign you one before posting."}
      </p>
    );
  }

  return (
    <select
      className="ann-scope-select"
      value={departmentId || ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">🌐 Whole org</option>
      {departments.map((d) => (
        <option key={d.id} value={d.id}>🏢 {d.name} only</option>
      ))}
    </select>
  );
}
