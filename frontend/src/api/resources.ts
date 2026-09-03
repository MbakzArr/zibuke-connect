import { apiRequest } from './client';

// Thin, typed wrappers around the backend endpoints. Components call these
// by name instead of knowing URLs, so if a route changes there's one place
// to update.

export interface Channel {
  id: string;
  name: string;
  department_id: string | null;
  is_private: boolean;
  created_by: string;
  created_at: string;
  member_count?: string;
  has_unread?: boolean;
}

export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  sender_name: string | null;
}

export interface Announcement {
  id: string;
  department_id: string | null;
  title: string;
  content: string;
  created_by: string;
  created_at: string;
  department_name: string | null;
  author_name: string | null;
}

export interface Person {
  id: string;
  email: string;
  status: string;
  availability?: string;
  full_name: string | null;
  job_title: string | null;
  department_name: string | null;
  heads_department_name?: string | null;
}


export interface Dm {
  channel_id: string;
  user_id: string;
  full_name: string | null;
  status: string;
  job_title: string | null;
  is_self?: boolean;
}


export interface Birthday {
  id: string;
  full_name: string | null;
  job_title: string | null;
  department_name: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  source_id: string;
  is_read: boolean;
  created_at: string;
  // Hydrated source detail (present depending on type)
  message_content?: string | null;
  message_channel_id?: string | null;
  sender_name?: string | null;
  announcement_title?: string | null;
  event_title?: string | null;
  event_starts_at?: string | null;
  event_venue?: string | null;
  department_name?: string | null;
  task_title?: string | null;
  task_due_date?: string | null;
  reaction_emoji?: string | null;
  reaction_target_type?: string | null;
  reactor_name?: string | null;
  reaction_message_content?: string | null;
  reaction_announcement_title?: string | null;
}


export interface BrowsableChannel {
  id: string;
  name: string;
  department_id: string | null;
  is_private: boolean;
  created_at: string;
  member_count: string;
  is_member: boolean;
}

export interface MessageSearchResult {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
  channel_name: string;
  is_dm: boolean;
  sender_name: string | null;
}


export interface PlaceChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_dm: boolean;
  is_member: boolean;
}

export interface PlaceDm {
  channel_id: string;
  user_id: string;
  full_name: string | null;
  status: string;
}


export interface ReactionCounts {
  [emoji: string]: { count: number; reacted: boolean; reactors: string[] };
}
export interface ReactionsMap {
  [targetId: string]: ReactionCounts;
}


export interface ChannelMember {
  id: string;
  email: string;
  status: string;
  full_name: string | null;
  job_title: string | null;
  joined_at: string;
}

export interface FullProfile {
  id: string;
  email: string;
  status: string;
  availability?: string;
  full_name: string | null;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  timezone: string | null;
  department_name: string | null;
  department_id?: string | null;
  address: string | null;
  hire_date: string | null;
  manager_name: string | null;
  heads_department_name: string | null;
  date_of_birth: string | null;
}

export const channelsApi = {
  list: () => apiRequest<{ channels: Channel[] }>('/api/v1/channels'),
  create: (name: string, isPrivate = false) =>
    apiRequest<{ channel: Channel }>('/api/v1/channels', {
      method: 'POST',
      body: { name, isPrivate },
    }),
  join: (id: string) =>
    apiRequest(`/api/v1/channels/${id}/join`, { method: 'POST' }),
  // Leaving a DM is how "delete this conversation" works: it removes you
  // from the channel's membership, so it drops out of your DM list. The
  // other person keeps their side and their history untouched. If you
  // message this person again later, a fresh DM channel is started.
  leave: (id: string) =>
    apiRequest(`/api/v1/channels/${id}/leave`, { method: 'POST' }),
  listDms: () => apiRequest<{ dms: Dm[] }>('/api/v1/channels/dm'),
  browse: () => apiRequest<{ channels: BrowsableChannel[] }>('/api/v1/channels/browse'),
  members: (channelId: string) =>
    apiRequest<{ members: ChannelMember[] }>(`/api/v1/channels/${channelId}/members`),
  markRead: (channelId: string) =>
    apiRequest(`/api/v1/channels/${channelId}/read`, { method: 'PATCH' }),
  readStatus: (channelId: string) =>
    apiRequest<{ otherLastReadAt: string | null }>(`/api/v1/channels/${channelId}/read-status`),
  searchPlaces: (q: string) =>
    apiRequest<{ channels: PlaceChannel[]; dms: PlaceDm[] }>(`/api/v1/channels/search?q=${encodeURIComponent(q)}`),
  openDm: (userId: string) =>
    apiRequest<{ channel: Channel }>(`/api/v1/channels/dm/${userId}`, { method: 'POST' }),
  history: (channelId: string, before?: string) => {
    const q = before ? `?before=${encodeURIComponent(before)}` : '';
    return apiRequest<{ messages: Message[] }>(
      `/api/v1/messages/channel/${channelId}${q}`
    );
  },
};


export interface RecentConversation {
  channel_id: string;
  content: string;
  created_at: string;
  channel_name: string;
  is_dm: boolean;
  sender_name: string | null;
  other_name: string | null;
}

export const messagesApi = {
  send: (channelId: string, content: string) =>
    apiRequest<{ message: Message }>('/api/v1/messages', {
      method: 'POST',
      body: { channelId, content },
    }),
  edit: (id: string, content: string) =>
    apiRequest<{ message: Message }>(`/api/v1/messages/${id}`, {
      method: 'PATCH',
      body: { content },
    }),
  remove: (id: string) =>
    apiRequest<{ message: Message }>(`/api/v1/messages/${id}`, { method: 'DELETE' }),
  restore: (id: string) =>
    apiRequest<{ message: Message }>(`/api/v1/messages/${id}/restore`, { method: 'POST' }),
  recent: () => apiRequest<{ conversations: RecentConversation[] }>('/api/v1/messages/recent'),
  search: (q: string, channelId?: string) => {
    const c = channelId ? `&channelId=${channelId}` : '';
    return apiRequest<{ results: MessageSearchResult[] }>(
      `/api/v1/messages/search?q=${encodeURIComponent(q)}${c}`
    );
  },
};

export const announcementsApi = {
  list: () => apiRequest<{ announcements: Announcement[] }>('/api/v1/announcements'),
  get: (id: string) => apiRequest<{ announcement: Announcement }>(`/api/v1/announcements/${id}`),
  create: (title: string, content: string, departmentId?: string | null) =>
    apiRequest<{ announcement: Announcement }>('/api/v1/announcements', {
      method: 'POST',
      body: { title, content, departmentId },
    }),
};

export const directoryApi = {
  list: () => apiRequest<{ people: Person[] }>('/api/v1/directory'),
  search: (q: string) =>
    apiRequest<{ results: Person[] }>(`/api/v1/directory/search?q=${encodeURIComponent(q)}`),
  birthdays: () => apiRequest<{ birthdays: Birthday[] }>('/api/v1/directory/birthdays'),
  profile: (userId: string) => apiRequest<{ profile: FullProfile }>(`/api/v1/directory/${userId}`),
  updateMe: (input: {
    fullName?: string;
    jobTitle?: string;
    phone?: string;
    address?: string;
    linkedinUrl?: string;
    timezone?: string;
    dateOfBirth?: string;
  }) => apiRequest<{ profile: FullProfile }>('/api/v1/directory/me', { method: 'PATCH', body: input }),
};

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: string;
  deleted_at: string | null;
  full_name: string | null;
  job_title: string | null;
  department_id: string | null;
  department_name: string | null;
}

export interface Department {
  id: string;
  name: string;
  head_user_id: string | null;
  head_name: string | null;
  created_at: string;
}

export const departmentsApi = {
  list: () => apiRequest<{ departments: Department[] }>('/api/v1/departments'),
  create: (name: string, headUserId?: string) =>
    apiRequest<{ department: Department }>('/api/v1/departments', {
      method: 'POST',
      body: { name, headUserId },
    }),
  update: (id: string, name?: string, headUserId?: string | null) =>
    apiRequest<{ department: Department }>(`/api/v1/departments/${id}`, {
      method: 'PATCH',
      body: { name, headUserId },
    }),
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/departments/${id}`, { method: 'DELETE' }),
};

export interface Webhook {
  id: string;
  channel_id: string;
  channel_name: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export const webhooksApi = {
  list: () => apiRequest<{ webhooks: Webhook[] }>('/api/v1/webhooks'),
  create: (channelId: string, label: string) =>
    apiRequest<{ webhook: Webhook; token: string; note: string }>('/api/v1/webhooks', {
      method: 'POST',
      body: { channelId, label },
    }),
  remove: (id: string) =>
    apiRequest<void>(`/api/v1/webhooks/${id}`, { method: 'DELETE' }),
};

export const adminApi = {
  listUsers: () => apiRequest<{ users: AdminUser[] }>('/api/v1/admin/users'),
  createEmployee: (input: { email: string; password: string; fullName: string; jobTitle?: string; role?: string; departmentId?: string | null }) =>
    apiRequest<{ user: { id: string; email: string; role: string } }>('/api/v1/admin/users', {
      method: 'POST',
      body: input,
    }),
  removeEmployee: (userId: string) =>
    apiRequest<{ removed: boolean }>(`/api/v1/admin/users/${userId}`, { method: 'DELETE' }),
  restoreEmployee: (userId: string) =>
    apiRequest<{ restored: boolean }>(`/api/v1/admin/users/${userId}/restore`, { method: 'POST' }),
  setRole: (userId: string, role: string) =>
    apiRequest<{ user: { id: string; role: string } }>(`/api/v1/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: { role },
    }),
  setDepartment: (userId: string, departmentId: string | null) =>
    apiRequest<{ user: { id: string; department_id: string | null } }>(`/api/v1/admin/users/${userId}/department`, {
      method: 'PATCH',
      body: { departmentId },
    }),
  resetPassword: (userId: string, newPassword: string) =>
    apiRequest<{ reset: boolean }>(`/api/v1/admin/users/${userId}/reset-password`, {
      method: 'PATCH',
      body: { newPassword },
    }),
};

export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: 'open' | 'done';
  assigned_to: string;
  assigned_by: string;
  created_at: string;
  completed_at: string | null;
  assignee_name: string | null;
  assigner_name: string | null;
}

export const tasksApi = {
  create: (input: { title: string; description?: string; assignedTo: string; dueDate?: string }) =>
    apiRequest<{ task: Task }>('/api/v1/tasks', { method: 'POST', body: input }),
  mine: () => apiRequest<{ tasks: Task[] }>('/api/v1/tasks/mine'),
  assignedByMe: () => apiRequest<{ tasks: Task[] }>('/api/v1/tasks/assigned-by-me'),
  monthDates: (year: number, month: number) =>
    apiRequest<{ dates: string[] }>(`/api/v1/tasks/month?year=${year}&month=${month}`),
  dueSoon: () => apiRequest<{ tasks: Task[] }>('/api/v1/tasks/due-soon'),
  setStatus: (id: string, status: 'open' | 'done') =>
    apiRequest<{ task: Task }>(`/api/v1/tasks/${id}/status`, { method: 'PATCH', body: { status } }),
  update: (id: string, fields: { title?: string; description?: string; dueDate?: string | null; assignedTo?: string }) =>
    apiRequest<{ task: Task }>(`/api/v1/tasks/${id}`, { method: 'PATCH', body: fields }),
  remove: (id: string) => apiRequest<{ deleted: boolean }>(`/api/v1/tasks/${id}`, { method: 'DELETE' }),
};

export const notificationsApi = {
  list: () => apiRequest<{ notifications: Notification[] }>('/api/v1/notifications'),
  markAllRead: () =>
    apiRequest('/api/v1/notifications/read-all', { method: 'PATCH' }),
  markDmRead: (channelId: string) =>
    apiRequest(`/api/v1/notifications/dm/${channelId}/read`, { method: 'PATCH' }),
};

export const reactionsApi = {
  list: (targetType: 'announcement' | 'birthday' | 'message', targetIds: string[]) =>
    apiRequest<{ reactions: ReactionsMap; allowed: string[] }>(
      `/api/v1/reactions?targetType=${targetType}&targetIds=${encodeURIComponent(targetIds.join(','))}`
    ),
  toggle: (targetType: 'announcement' | 'birthday' | 'message', targetId: string, emoji: string) =>
    apiRequest<{ status: 'added' | 'removed' }>('/api/v1/reactions/toggle', {
      method: 'POST',
      body: { targetType, targetId, emoji },
    }),
};

export interface Event {
  id: string;
  title: string;
  starts_at: string;
  venue: string | null;
  created_by: string;
  author_name: string | null;
  attendee_names: string[];
}

export const eventsApi = {
  today: () => apiRequest<{ events: Event[] }>('/api/v1/events/today'),
  forDate: (date: string) => apiRequest<{ events: Event[] }>(`/api/v1/events?date=${date}`),
  monthDates: (year: number, month: number) =>
    apiRequest<{ dates: string[] }>(`/api/v1/events/month?year=${year}&month=${month}`),
  create: (title: string, startsAt: string, venue?: string, attendeeIds?: string[]) =>
    apiRequest<{ event: Event }>('/api/v1/events', {
      method: 'POST',
      body: { title, startsAt, venue, attendeeIds },
    }),
  update: (id: string, fields: { title?: string; startsAt?: string; venue?: string }) =>
    apiRequest<{ event: Event }>(`/api/v1/events/${id}`, { method: 'PATCH', body: fields }),
  remove: (id: string) => apiRequest(`/api/v1/events/${id}`, { method: 'DELETE' }),
};

export const usersApi = {
  setAvailability: (availability: 'available' | 'busy' | 'away') =>
    apiRequest<{ availability: string }>('/api/v1/users/me/availability', {
      method: 'PATCH',
      body: { availability },
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<{ changed: boolean }>('/api/v1/users/me/password', {
      method: 'PATCH',
      body: { currentPassword, newPassword },
    }),
};
