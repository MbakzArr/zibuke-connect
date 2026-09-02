import { pool } from '../../db/pool';
import { hashPassword, comparePassword } from '../auth/password';

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

// Self-service password change. Requires the CURRENT password, same as
// any normal "change password" flow - this isn't a reset (no email/token
// involved), it's for someone who already knows their password and wants
// a new one, including an admin-created account's first login.
export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const user = result.rows[0];
  if (!user) {
    throw new Error('NOT_FOUND');
  }
  const matches = await comparePassword(currentPassword, user.password_hash);
  if (!matches) {
    throw new Error('WRONG_PASSWORD');
  }
  const newHash = await hashPassword(newPassword);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
  return true;
}
