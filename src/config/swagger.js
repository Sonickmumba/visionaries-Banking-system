const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Visionaries Banking System API',
      version: '1.0.0',
      description:
        'REST API for the Visionaries Banking System — managing savings cycles, loans, declarations, repayments, approvals, penalties, and reports.'
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000',
        description: process.env.NODE_ENV === 'production' ? 'Production' : 'Development'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'vb-token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            limit:  { type: 'integer' },
            offset: { type: 'integer' },
            count:  { type: 'integer' }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }]
  },
  // Pick up JSDoc annotations from all route files
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js'
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
