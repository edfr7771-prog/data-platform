import 'server-only';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const g = globalThis as unknown as { __rdPool?: Pool };

function pool(): Pool {
  if (!g.__rdPool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    g.__rdPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return g.__rdPool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params as never[]);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
