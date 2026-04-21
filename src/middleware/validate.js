const { validationResult } = require('express-validator');

/**
 * Validation middleware — supports two calling conventions:
 *
 * 1. Factory pattern (used with param/query/body chains passed directly):
 *      validate([param('id').isInt(), ...])
 *    Returns a middleware that runs each chain then checks for errors.
 *
 * 2. Direct middleware pattern (used after an array of validators):
 *      router.get('/', [query('x').isInt()], validate, handler)
 *    Acts as middleware that checks for already-run validation errors.
 */
const validate = (reqOrValidators, res, next) => {
  if (Array.isArray(reqOrValidators)) {
    // Factory usage: returns a composed middleware
    return async (req, res, next) => {
      try {
        await Promise.all(reqOrValidators.map((v) => v.run(req)));
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  // Direct middleware usage: validators already ran, just check results
  const errors = validationResult(reqOrValidators);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
};

module.exports = validate;
