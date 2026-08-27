import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Single shared connection pool. Every module imports this instead of
// creating its own connection, so we only ever manage one pool.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
  process.exit(1);
});
