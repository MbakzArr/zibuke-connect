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
  [emoji: string]: { count: number; reacted: boolean };
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
  address: string | null;
  hire_date: string | null;
  manager_name: string | null;
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
  listDms: () => apiRequest<{ dms: Dm[] }>('/api/v1/channels/dm'),
  browse: () => apiRequest<{ channels: BrowsableChannel[] }>('/api/v1/channels/browse'),
  members: (channelId: string) =>
    apiRequest<{ members: ChannelMember[] }>(`/api/v1/channels/${channelId}/members`),
  markRead: (channelId: string) =>
    apiRequest(`/api/v1/channels/${channelId}/read`, { method: 'PATCH' }),
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
  edit: (id: string, content: string) =>
    apiRequest<{ message: Message }>(`/api/v1/messages/${id}`, {
      method: 'PATCH',
      body: { content },
    }),
  remove: (id: string) =>
    apiRequest<{ message: Message }>(`/api/v1/messages/${id}`, { method: 'DELETE' }),
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
  birthdays: () => apiRequest<{ birthdays: Birthday[] }>('/api/v1/directory/birthdays'),
  profile: (userId: string) => apiRequest<{ profile: FullProfile }>(`/api/v1/directory/${userId}`),
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
};
