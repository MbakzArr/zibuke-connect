import { pool } from '../../db/pool';

const ALLOWED = ['available', 'busy', 'away'];

// Set the caller's manual availability. Deliberately only these three
// values - see the migration comment for why "offline" isn't one of them.
export async function setAvailability(userId: string, availability: string) {
  if (!ALLOWED.includes(availability)) {
    throw new Error('INVALID_AVAILABILITY');
  }
  await pool.query('UPDATE users SET availability = $1 WHERE id = $2', [availability, userId]);
  return true;
}
