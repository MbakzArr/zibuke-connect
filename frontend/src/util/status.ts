// Shared logic for showing a person's live status everywhere they appear
// (People Online, Directory, DM header, profile card). Availability
// (Available/Busy/Away) is only meaningful while actually connected - if
// someone is offline, their last-chosen availability doesn't matter, they
// just show as Offline. This mirrors the same honest rule used when the
// status picker was built: no manually-selectable "Offline" while
// connected, and no showing a stale availability while disconnected.

export function statusColor(connectionStatus: string, availability?: string | null): string {
  if (connectionStatus !== 'online') return '#9ca3af'; // grey - offline
  if (availability === 'busy') return '#ef4444'; // red
  if (availability === 'away') return '#f59e0b'; // amber
  return '#22c55e'; // green - available (default)
}

export function statusLabel(connectionStatus: string, availability?: string | null): string {
  if (connectionStatus !== 'online') return 'Offline';
  if (availability === 'busy') return 'Busy';
  if (availability === 'away') return 'Away';
  return 'Available';
}
