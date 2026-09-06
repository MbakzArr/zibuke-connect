// Give each user a stable colour derived from their id, so avatars are
// visually distinct and the same person is always the same colour. Purely
// presentational; nothing depends on the exact value. Defensive against a
// missing/non-string id (falls back to the palette's first colour) rather
// than throwing and taking down whatever list it's rendered inside - the
// exact same reasoning TasksWidget's formatDue already follows for a bad
// due date, applied here too.

const PALETTE = [
  '#4f46e5', // indigo
  '#0891b2', // cyan
  '#16a34a', // green
  '#d97706', // amber
  '#db2777', // pink
  '#7c3aed', // violet
  '#dc2626', // red
  '#0d9488', // teal
];

export function colorFor(id: string | null | undefined): string {
  if (!id) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
