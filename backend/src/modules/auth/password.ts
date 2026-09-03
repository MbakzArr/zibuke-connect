import bcrypt from 'bcryptjs';

// Uses bcryptjs (pure JavaScript), not bcrypt - bcrypt is a native
// compiled addon (see its binding.gyp/node-gyp-build dependency), which
// cannot run in Cloudflare Workers' V8 isolate sandbox at all; there's no
// native code execution there. bcryptjs implements the exact same bcrypt
// hash format ($2a$/$2b$...), so it's a drop-in replacement - existing
// password hashes created by the Render backend's native bcrypt verify
// correctly here too, and vice versa, since both databases are the same
// shared Postgres instance.
const SALT_ROUNDS = 12;

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export function comparePassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}
