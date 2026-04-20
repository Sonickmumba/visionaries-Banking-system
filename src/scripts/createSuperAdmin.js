const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { ROLES } = require('../config/constants');

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

const required = ['SUPER_ADMIN_EMAIL', 'SUPER_ADMIN_PASSWORD', 'SUPER_ADMIN_FULL_NAME'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const createInitialSuperAdmin = async () => {
  const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const fullName = process.env.SUPER_ADMIN_FULL_NAME.trim();
  const phone = process.env.SUPER_ADMIN_PHONE?.trim() || null;

  if (password.length < 8) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters long');
  }

  const superAdminCount = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE role = $1', [ROLES.SUPER_ADMIN]);
  if (superAdminCount.rows[0].count > 0) {
    throw new Error('A super admin already exists. Use the role-management endpoint to grant more super admins.');
  }

  const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    throw new Error('A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await db.query(
    `INSERT INTO users (email, password_hash, full_name, phone, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, full_name, phone, role, status, created_at`,
    [email, passwordHash, fullName, phone, ROLES.SUPER_ADMIN]
  );

  return result.rows[0];
};

createInitialSuperAdmin()
  .then((user) => {
    console.log(`Created initial super admin: ${user.email}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });