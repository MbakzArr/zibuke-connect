import fs from 'fs';
import path from 'path';
import { pool } from './pool';

// Small, dependency-free migration runner. Keeps a record of which
// migration files have already run in a schema_migrations table, and
// runs any new ones in filename order. No ORM, plain SQL files, easy
// to read and explain in review.

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file}, already applied`);
      continue;
    }

    console.log(`Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); // needed for gen_random_uuid()
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed applying ${file}:`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log('Migrations complete');
  await pool.end();
}

run();
