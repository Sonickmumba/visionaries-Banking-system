const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { ROLES } = require('./constants');

const DEFAULT_ROLE = ROLES.MEMBER;

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

const configurePassport = () => {
  passport.use(
    'local-signup',
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
        passReqToCallback: true,
        session: false,
      },
      async (req, email, password, done) => {
        try {
          const normalizedEmail = normalizeEmail(email);
          const { full_name, phone, groupId } = req.body;

          if (!normalizedEmail || !password || !full_name) {
            return done(null, false, {
              message: 'email, password, and full_name are required',
            });
          }

          const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
          if (existingUser.rows.length > 0) {
            return done(null, false, { message: 'User with this email already exists' });
          }

          const salt = await bcrypt.genSalt(10);
          const passwordHash = await bcrypt.hash(password, salt);

          const result = await db.query(
            `INSERT INTO users (email, password_hash, full_name, phone, role)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, email, full_name, phone, role, status, created_at`,
            [normalizedEmail, passwordHash, full_name, phone || null, DEFAULT_ROLE]
          );

          const newUser = result.rows[0];

          // Auto-add to group if groupId provided
        //   if (groupId) {
        //     const groupExists = await db.query(
        //       'SELECT id FROM groups WHERE id = $1 AND is_active = true',
        //       [groupId]
        //     );
        //     if (groupExists.rows.length > 0) {
        //       await db.query(
        //         'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        //         [groupId, newUser.id]
        //       );
        //     }
        //   }

          return done(null, newUser);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.use(
    'local-login',
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
        session: false,
      },
      async (email, password, done) => {
        try {
          const normalizedEmail = normalizeEmail(email);
          if (!normalizedEmail || !password) {
            return done(null, false, { message: 'Email and password are required' });
          }

          const result = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
          if (result.rows.length === 0) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          const user = result.rows[0];
          if (!user.status) {
            return done(null, false, { message: 'Your account has been deactivated' });
          }

          const isPasswordValid = await bcrypt.compare(password, user.password_hash);
          if (!isPasswordValid) {
            return done(null, false, { message: 'Invalid email or password' });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const result = await db.query(
        'SELECT id, email, full_name, phone, role, status, created_at FROM users WHERE id = $1',
        [id]
      );
      return done(null, result.rows[0] || false);
    } catch (error) {
      return done(error, null);
    }
  });

  return passport;
};

module.exports = configurePassport;
