import { pool } from '../../db/pool';
import { hashPassword, comparePassword } from './password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './tokens';

interface RegisterInput {
  organizationId: string;
  email: string;
  password: string;
  fullName: string;
}

interface LoginInput {
  email: string;
  password: string;
}

export async function registerUser(input: RegisterInput) {
  const { organizationId, password, fullName } = input;
  // Emails are case-insensitive: store and compare lowercased so
  // "Arehone@..." and "arehone@..." are treated as the same account.
  const email = input.email.trim().toLowerCase();

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new Error('EMAIL_ALREADY_REGISTERED');
  }

  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'employee')
       RETURNING id, organization_id, email, role`,
      [organizationId, email, passwordHash]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO employee_profiles (user_id, full_name)
       VALUES ($1, $2)`,
      [user.id, fullName]
    );

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function loginUser(input: LoginInput) {
  const { password } = input;
  // Match the same lowercasing used at registration, so login is
  // case-insensitive on the email.
  const email = input.email.trim().toLowerCase();

  const result = await pool.query(
    'SELECT id, organization_id, email, password_hash, role FROM users WHERE email = $1',
    [email]
  );
  const user = result.rows[0];

  if (!user) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const passwordMatches = await comparePassword(password, user.password_hash);
  if (!passwordMatches) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const tokenPayload = {
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
  };

  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  await pool.query(
    `UPDATE users SET status = 'online', last_seen_at = now() WHERE id = $1`,
    [user.id]
  );

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, role: user.role },
  };
}

export function refreshAccessToken(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);
  const accessToken = signAccessToken({
    userId: payload.userId,
    organizationId: payload.organizationId,
    role: payload.role,
  });
  return { accessToken };
}
