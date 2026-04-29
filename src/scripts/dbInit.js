const { spawnSync } = require('child_process');
const path = require('path');
require('dotenv').config();

const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const schemaPath = path.resolve(__dirname, '../database/schema.sql');

const result = spawnSync(
  'psql',
  [
    '-h', process.env.DB_HOST,
    '-p', process.env.DB_PORT,
    '-U', process.env.DB_USER,
    '-d', process.env.DB_NAME,
    '-f', schemaPath,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PGPASSWORD: process.env.DB_PASSWORD,
    },
  }
);

if (result.error) {
  console.error('Failed to execute psql. Ensure PostgreSQL client tools are installed and psql is in PATH.');
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log('✅ Schema initialized successfully');
