import { pool } from '../../db/pool';

// Presence is driven by live socket connections, not by login. A user can
// have more than one connection open (laptop + phone), so we count
// connections per user and only mark them offline when the last one closes.
// This map lives in memory on this server instance. For the single-server
// demo that's correct; the scaling note is that a multi-server deployment
// would move this into Redis so presence is shared across instances.

const connectionCounts = new Map<string, number>();

export async function markOnline(userId: string) {
  const current = connectionCounts.get(userId) || 0;
  connectionCounts.set(userId, current + 1);

  if (current === 0) {
    await pool.query(
      `UPDATE users SET status = 'online', last_seen_at = now() WHERE id = $1`,
      [userId]
    );
  }
}

export async function markOffline(userId: string) {
  const current = connectionCounts.get(userId) || 0;
  const next = Math.max(0, current - 1);

  if (next === 0) {
    connectionCounts.delete(userId);
    await pool.query(
      `UPDATE users SET status = 'offline', last_seen_at = now() WHERE id = $1`,
      [userId]
    );
  } else {
    connectionCounts.set(userId, next);
  }
}

export function isOnline(userId: string): boolean {
  return (connectionCounts.get(userId) || 0) > 0;
}
