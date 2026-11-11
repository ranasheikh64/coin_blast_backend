/**
 * Security Headers Middleware
 */
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.removeHeader('X-Powered-By');
  next();
};

/**
 * Lightweight in-memory sliding-window rate limiter.
 * Prevents brute-force, bot farming, and rapid cashout spam.
 */
const createRateLimiter = ({ windowMs = 60000, max = 60, message = 'Too many requests, please slow down.' } = {}) => {
  const hits = new Map();

  // Periodic cleanup to avoid unbounded memory growth
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits.entries()) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, valid);
      }
    }
  }, Math.max(windowMs, 30000));
  if (cleanup.unref) cleanup.unref();

  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    const userId = req.user?._id ? req.user._id.toString() : 'anon';
    const key = `${ip}:${userId}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    const recent = (hits.get(key) || []).filter((t) => t > cutoff);
    if (recent.length >= max) {
      return res.status(429).json({
        success: false,
        message,
      });
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
};

module.exports = {
  securityHeaders,
  createRateLimiter,
};
