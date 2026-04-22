/**
 * Migration: add 'pending' to users.status CHECK constraint
 * and backfill member-role users who have no members row.
 *
 * Run once:  node src/scripts/migrate-pending-status.js
 */
require('dotenv').config();
const db = require('../config/database');

async function run() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Drop the old CHECK constraint and re-create it with 'pending'
    // The constraint name in schema.sql is inlined (no explicit name), so
    // we query information_schema to find it first.
    const conResult = await client.query(`
      SELECT conname
      FROM   pg_constraint
      WHERE  conrelid = 'users'::regclass
        AND  contype  = 'c'
        AND  conname  LIKE '%status%'
    `);

    if (conResult.rows.length > 0) {
      const constraintName = conResult.rows[0].conname;
      await client.query(`ALTER TABLE users DROP CONSTRAINT "${constraintName}"`);
      console.log(`Dropped constraint: ${constraintName}`);
    } else {
      console.log('No status CHECK constraint found — skipping drop.');
    }

    await client.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'inactive', 'suspended', 'pending'))
    `);
    console.log('Added new users_status_check constraint with pending.');

    // 2. Backfill: find member-role users with no members row in any cycle,
    //    mark them pending so admins can review + enroll them.
    const backfillResult = await client.query(`
      UPDATE users
      SET    status = 'pending'
      WHERE  role   = 'member'
        AND  status = 'active'
        AND  id NOT IN (SELECT DISTINCT user_id FROM members WHERE user_id IS NOT NULL)
      RETURNING id, email, full_name
    `);
    console.log(`Backfilled ${backfillResult.rows.length} unenrolled member(s) to pending:`);
    backfillResult.rows.forEach((u) => console.log(`  #${u.id} ${u.full_name} <${u.email}>`));

    await client.query('COMMIT');
    console.log('\nMigration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

run();
