# Zibuke Collaboration System — Backend (Day 1)

Node.js + TypeScript + Express + PostgreSQL backend. Day 1 scope: full DB
schema, migrations, and the auth module (login, refresh - see below for
how the first account gets created now that self-registration is gone).

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a PostgreSQL database:
   ```
   createdb zibuke_collab
   ```
   (or use `psql` / pgAdmin, whatever you've got set up locally)

3. Copy the env file and fill in real secrets:
   ```
   cp .env.example .env
   ```
   Generate random values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`,
   don't leave the placeholders. Something like:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   run twice, once for each secret.

4. Run migrations:
   ```
   npm run migrate
   ```
   This creates every table in the spec (organizations, users,
   employee_profiles, departments, channels, channel_members, messages,
   mentions, announcements, notifications) plus indexes.

5. Start the dev server:
   ```
   npm run dev
   ```
   Server runs on http://localhost:4000 by default.

## Creating the first admin account

There's no public self-registration endpoint (there used to be a POST
/auth/register - it was removed because organizationId is embedded in
every access token, and JWTs are signed, not encrypted, so anyone could
decode their own token and self-register a new account into a real
org, bypassing admin control entirely). Every account after the first is
created through the admin panel (POST /api/v1/admin/users), which is
correctly gated - but that itself needs an existing admin to be logged in,
which creates a bootstrapping problem for a brand new database: how do you
create the very FIRST account?

Answer: directly in the database, once, by hand. You need an organization
row first, since every user belongs to one:

```sql
INSERT INTO organizations (name) VALUES ('Zibuke Africa') RETURNING id;
```

Then hash a real password (bcrypt, 12 rounds, matching what the app uses):

```
node -e "require('bcrypt').hash('YOUR-REAL-PASSWORD', 12).then(console.log)"
```

Then insert the first user directly, as an admin, using both the
organization id and the hash from the two steps above:

```sql
INSERT INTO users (organization_id, email, password_hash, role)
VALUES ('<paste-org-id>', 'arehone@zibuke.co.za', '<paste-bcrypt-hash>', 'admin')
RETURNING id;

INSERT INTO employee_profiles (user_id, full_name)
VALUES ('<paste-user-id-from-above>', 'Arehone Mbadaliga');
```

From there, log in normally and use the admin panel (⚙ in the account
menu) to add everyone else - no more direct SQL needed after this one
bootstrap step.

**Login:**
```
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"arehone@zibuke.co.za","password":"YOUR-REAL-PASSWORD"}'
```
This returns an `accessToken` and `refreshToken`.

**Check the protected route:**
```
curl http://localhost:4000/api/v1/me \
  -H "Authorization: Bearer <paste-accessToken-here>"
```
Should return your user id, organization id and role, proof the JWT
middleware is working.

**Refresh:**
```
curl -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<paste-refreshToken-here>"}'
```

## Structure

```
src/
  db/
    pool.ts        — shared Postgres connection pool
    migrate.ts      — runs migrations/*.sql files in order, tracks what's applied
  modules/
    auth/
      password.ts       — bcrypt hashing
      tokens.ts         — JWT sign/verify
      auth.service.ts   — login/refresh business logic
      auth.controller.ts — request/response handling
      auth.routes.ts    — Express routes, rate limited
  middleware/
    requireAuth.ts  — protects routes, attaches req.user from the JWT
  index.ts          — app entry point
migrations/
  001_init.sql       — full schema
```

Next modules to build on top of this (Day 2): `directory`, `departments`,
`channels`, following the same pattern — service, controller, routes.
