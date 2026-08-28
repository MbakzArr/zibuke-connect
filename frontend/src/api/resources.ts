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
  history: (channelId: string, before?: string) => {
    const q = before ? `?before=${encodeURIComponent(before)}` : '';
    return apiRequest<{ messages: Message[] }>(
      `/api/v1/messages/channel/${channelId}${q}`
    );
  },
};

export const announcementsApi = {
  list: () => apiRequest<{ announcements: Announcement[] }>('/api/v1/announcements'),
  create: (title: string, content: string) =>
    apiRequest<{ announcement: Announcement }>('/api/v1/announcements', {
      method: 'POST',
      body: { title, content },
    }),
};

export const directoryApi = {
  list: () => apiRequest<{ people: Person[] }>('/api/v1/directory'),
  search: (q: string) =>
    apiRequest<{ results: Person[] }>(`/api/v1/directory/search?q=${encodeURIComponent(q)}`),
};

export const notificationsApi = {
  list: () => apiRequest<{ notifications: Notification[] }>('/api/v1/notifications'),
  markAllRead: () =>
    apiRequest('/api/v1/notifications/read-all', { method: 'PATCH' }),
};
