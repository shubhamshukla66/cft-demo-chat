import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { config } from '../src/config.js';
const pool = new Pool({ connectionString: config.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(8042026)');
  await client.query(
    await readFile(new URL('../sql/001_init.sql', import.meta.url), 'utf8'),
  );
  await client.query('COMMIT');
  console.log('Schema ready');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
