/**
 * Authentication and Security Middleware
 *
 * Provides API key authentication, CORS, and rate limiting for Convex integration mode
 */

import http from 'http';
import { getConvexConfig } from '../config/ConvexConfig.js';

/**
 * Middleware function type
 */
export type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void | Promise<void>
) => void | Promise<void>;

/**
 * Rate limit store entry
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limit stores
 */
const rateLimitStores = {
  byUser: new Map<string, RateLimitEntry>(),
  byIp: new Map<string, RateLimitEntry>(),
};

/**
 * Cleanup old rate limit entries periodically
 */
setInterval(() => {
  const now = Date.now();

  // Clean up user rate limits
  for (const [key, entry] of rateLimitStores.byUser.entries()) {
    if (entry.resetTime < now) {
      rateLimitStores.byUser.delete(key);
    }
  }

  // Clean up IP rate limits
  for (const [key, entry] of rateLimitStores.byIp.entries()) {
    if (entry.resetTime < now) {
      rateLimitStores.byIp.delete(key);
    }
  }
}, 60 * 1000); // Clean up every minute

/**
 * Extract client IP from request
 */
function getClientIp(req: http.IncomingMessage): string {
  // Check for proxied IP
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  // Check for real IP (some proxies use this)
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fallback to socket remote address
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Send JSON error response
 */
export function sendJsonError(
  res: http.ServerResponse,
  statusCode: number,
  error: string,
  message?: string
): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error,
    message: message || error,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Send JSON success response
 */
export function sendJsonSuccess(
  res: http.ServerResponse,
  data: any,
  statusCode: number = 200
): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Enhanced CORS middleware for Convex integration
 */
export function corsMiddleware(): Middleware {
  return (req, res, next) => {
    const config = getConvexConfig();

    if (!config.isEnabled()) {
      // In non-Convex mode, allow all (backward compatibility)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      return next();
    }

    // Get origin from request
    const origin = req.headers.origin;

    // Check if origin is allowed
    if (origin && config.isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (config.getAllowedOrigins().includes('*')) {
      // Allow all if wildcard is set
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      // Origin not allowed
      if (req.method !== 'OPTIONS') {
        return sendJsonError(res, 403, 'Forbidden', 'Origin not allowed');
      }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    next();
  };
}

/**
 * API Key authentication middleware
 */
export function apiKeyAuth(): Middleware {
  return (req, res, next) => {
    const config = getConvexConfig();

    // Skip authentication if not in Convex mode
    if (!config.isEnabled()) {
      return next();
    }

    // Extract API key from headers
    const apiKey =
      req.headers['x-api-key'] as string ||
      req.headers['authorization']?.replace('Bearer ', '') ||
      '';

    // Validate API key
    if (!config.validateApiKey(apiKey)) {
      return sendJsonError(res, 401, 'Unauthorized', 'Invalid or missing API key');
    }

    // API key is valid, continue
    next();
  };
}

/**
 * Rate limiting middleware for token injection endpoints
 */
export function rateLimitTokenInjection(): Middleware {
  return (req, res, next) => {
    const config = getConvexConfig();

    if (!config.isEnabled()) {
      return next();
    }

    const ip = getClientIp(req);
    const rateLimitConfig = config.getRateLimitConfig();
    const now = Date.now();

    // Get or create rate limit entry
    let entry = rateLimitStores.byIp.get(ip);

    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired one
      entry = {
        count: 0,
        resetTime: now + rateLimitConfig.windowMs,
      };
      rateLimitStores.byIp.set(ip, entry);
    }

    // Increment count
    entry.count++;

    // Check if limit exceeded
    if (entry.count > rateLimitConfig.maxTokenInjectionsPerIp) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(rateLimitConfig.maxTokenInjectionsPerIp));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(entry.resetTime));

      return sendJsonError(
        res,
        429,
        'Too Many Requests',
        `Rate limit exceeded. Try again in ${retryAfter} seconds.`
      );
    }

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', String(rateLimitConfig.maxTokenInjectionsPerIp));
    res.setHeader('X-RateLimit-Remaining', String(rateLimitConfig.maxTokenInjectionsPerIp - entry.count));
    res.setHeader('X-RateLimit-Reset', String(entry.resetTime));

    next();
  };
}

/**
 * Rate limiting middleware for tool requests (per user)
 */
export function rateLimitToolRequests(userId?: string): Middleware {
  return (req, res, next) => {
    const config = getConvexConfig();

    if (!config.isEnabled() || !userId) {
      return next();
    }

    const rateLimitConfig = config.getRateLimitConfig();
    const now = Date.now();

    // Get or create rate limit entry
    let entry = rateLimitStores.byUser.get(userId);

    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired one
      entry = {
        count: 0,
        resetTime: now + rateLimitConfig.windowMs,
      };
      rateLimitStores.byUser.set(userId, entry);
    }

    // Increment count
    entry.count++;

    // Check if limit exceeded
    if (entry.count > rateLimitConfig.maxRequestsPerUser) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(rateLimitConfig.maxRequestsPerUser));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(entry.resetTime));

      return sendJsonError(
        res,
        429,
        'Too Many Requests',
        `User rate limit exceeded. Try again in ${retryAfter} seconds.`
      );
    }

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', String(rateLimitConfig.maxRequestsPerUser));
    res.setHeader('X-RateLimit-Remaining', String(rateLimitConfig.maxRequestsPerUser - entry.count));
    res.setHeader('X-RateLimit-Reset', String(entry.resetTime));

    next();
  };
}

/**
 * Request size limit middleware
 */
export function requestSizeLimit(maxSize: number = 10 * 1024 * 1024): Middleware {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > maxSize) {
      return sendJsonError(
        res,
        413,
        'Payload Too Large',
        `Request size exceeds maximum allowed size of ${maxSize} bytes`
      );
    }

    next();
  };
}

/**
 * Security headers middleware
 */
export function securityHeaders(): Middleware {
  return (req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Content Security Policy
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
    );

    next();
  };
}

/**
 * Compose multiple middleware functions
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return async (req, res, next) => {
    let index = 0;

    const runNext = async (): Promise<void> => {
      if (index >= middlewares.length) {
        return next();
      }

      const middleware = middlewares[index++];
      await middleware(req, res, runNext);
    };

    await runNext();
  };
}

/**
 * Parse JSON body from request
 */
export function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const parsed = body.trim() ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Clear rate limit stores (for testing)
 */
export function clearRateLimits(): void {
  rateLimitStores.byUser.clear();
  rateLimitStores.byIp.clear();
}
