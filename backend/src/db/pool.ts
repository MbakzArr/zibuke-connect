import { Client } from 'pg';
import { env } from 'cloudflare:workers';

// CLOUDFLARE WORKERS VERSION of this file (cloudflare branch only - the
// Render/Node version, a single long-lived pg.Pool, is a separate,
// unmodified file). Workers doesn't allow holding a database connection
// open across requests in module scope - Cloudflare's own Hyperdrive docs
// are explicit that a Pool created at the top level "will leave you with
// stale connections that result in failures." Hyperdrive already does
// real connection pooling on Cloudflare's side, specifically so that
// opening a fresh Client per call is fast rather than a compromise - that
// startup-latency problem is the thing Hyperdrive exists to solve.
//
// The `pool` object below is written to match pg.Pool's shape exactly
// (.query(), and .connect() returning something with .query()/.release())
// on purpose: every other file in this codebase does
// `import { pool } from '../../db/pool'` and calls `pool.query(...)` or
// `pool.connect()` for a transaction, and none of those ~20 call sites
// needed to change for this - only this one file did.

interface HyperdriveEnv {
  HYPERDRIVE: { connectionString: string };
}

function hyperdriveConnectionString(): string {
  return (env as unknown as HyperdriveEnv).HYPERDRIVE.connectionString;
}

export const pool = {
  async query(text: string, params?: unknown[]) {
    const client = new Client({ connectionString: hyperdriveConnectionString() });
    await client.connect();
    try {
      return await client.query(text, params);
    } finally {
      await client.end();
    }
  },

  // Mirrors pg.Pool.connect(): returns a client-shaped object for callers
  // running several queries as one transaction (BEGIN/.../COMMIT or
  // ROLLBACK), e.g. admin.service.ts's createEmployee. release() ends the
  // connection - same job client.release() does in the Node version,
  // just without an actual pool to return the connection to.
  async connect() {
    const client = new Client({ connectionString: hyperdriveConnectionString() });
    await client.connect();
    return {
      query: client.query.bind(client),
      release: () => client.end(),
    };
  },
};
