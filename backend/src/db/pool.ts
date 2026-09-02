import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Single shared connection pool. Every module imports this instead of
// creating its own connection, so we only ever manage one pool.
//
// SSL: Render's managed Postgres only REQUIRES TLS on external
// connections - the deployed backend itself talks to the database over
// Render's internal network (the Internal Database URL), which doesn't
// enforce it, so this never showed up in production. Running anything
// locally against the EXTERNAL database URL (migrations, one-off scripts)
// hits the enforced case and fails with "SSL/TLS required" without this.
// Enabling it for any render.com host is safe either way - Postgres
// accepts SSL on the internal path too, it's just not mandatory there.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
  process.exit(1);
});
