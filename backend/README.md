# Zibuke Collaboration System — Backend (Day 1)

Node.js + TypeScript + Express + PostgreSQL backend. Day 1 scope: full DB
schema, migrations, and the auth module (register, login, refresh).

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

## Testing the auth flow

You need an organization row to register a user against, since every
user belongs to one. Quickest way for now, run this once against your
database:

```sql
INSERT INTO organizations (name) VALUES ('Zibuke Africa') RETURNING id;
```

Copy the returned id, then:

**Register:**
```
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"<paste-id-here>","email":"arehone@zibuke.co.za","password":"testpassword123","fullName":"Arehone Mbadaliga"}'
```

**Login:**
```
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"arehone@zibuke.co.za","password":"testpassword123"}'
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
      auth.service.ts   — register/login/refresh business logic
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
