const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const cloudinary = require('cloudinary').v2;
const configurePassport = require('./config/passport');
const db = require('./config/database');
const swaggerUi   = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// routes
const authRoutes             = require('./routes/authRoutes');
const approvalsRoutes        = require('./routes/approvals');
const cyclesRoutes           = require('./routes/cyclesRoutes');
const declarationsRoutes     = require('./routes/declarationsRoutes');
const filesRoutes            = require('./routes/filesRoutes');
const loansRoutes            = require('./routes/loansRoutes');
const loanRepaymentsRoutes   = require('./routes/loanRepaymentsRoutes');
const membersRoutes          = require('./routes/membersRoutes');
const monthProcessingRoutes  = require('./routes/monthProcessingRoutes');
const penaltiesRoutes        = require('./routes/penaltiesRoutes');
const reportsRoutes          = require('./routes/reportsRoutes');
const savingsRoutes          = require('./routes/savingsRoutes');
const commonInterestRoutes   = require('./routes/commonInterestRoutes');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Passport strategies
configurePassport();

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : true;

const corsOptions = {
  origin: corsOrigins,
  credentials: true,
};

// Security headers
app.use(helmet());

// CORS
app.use(cors(corsOptions));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(
  session({
    name: 'visionaries.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PgSession({
      pool: db.pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Swagger UI (disable in production if desired)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Visionaries Banking API Docs',
    swaggerOptions: { persistAuthorization: true }
  }));
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

// Routes
app.use('/api/auth',             authRoutes);
app.use('/api/approvals',        approvalsRoutes);
app.use('/api/cycles',           cyclesRoutes);
app.use('/api/declarations',     declarationsRoutes);
app.use('/api/files',            filesRoutes);
app.use('/api/loans',            loansRoutes);
app.use('/api/repayments',       loanRepaymentsRoutes);
app.use('/api/members',          membersRoutes);
app.use('/api/month-processing', monthProcessingRoutes);
app.use('/api/penalties',        penaltiesRoutes);
app.use('/api/reports',          reportsRoutes);
app.use('/api/savings',          savingsRoutes);
app.use('/api/common-interest',  commonInterestRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

module.exports = app;
