import { pool } from '../../db/pool';
import { comparePassword } from './password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './tokens';

interface LoginInput {
  email: string;
  password: string;
}

// Self-registration (registerUser) used to live here, wired to a public
// POST /register. It's gone - see the comment in auth.routes.ts for why.
// Account creation is now admin-only, via modules/admin/admin.service.ts's
// createEmployee, which does the same job (hash password, insert user +
// profile in one transaction) behind a proper permission check.

export async function loginUser(input: LoginInput) {
  const { password } = input;
  // Match the same lowercasing used at registration, so login is
  // case-insensitive on the email.
  const email = input.email.trim().toLowerCase();

  const result = await pool.query(
    'SELECT id, organization_id, email, password_hash, role FROM users WHERE email = $1 AND deleted_at IS NULL',
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
