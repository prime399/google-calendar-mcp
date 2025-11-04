/**
 * Management API Endpoints
 *
 * Provides health checks, metrics, and administrative endpoints
 */

import http from 'http';
import { getConvexTokenProvider } from '../auth/convexTokenProvider.js';
import { getConvexConfig } from '../config/ConvexConfig.js';
import { sendJsonSuccess } from '../middleware/auth.js';

/**
 * Parse URL path
 */
function parseUrl(url: string = '/'): string {
  return url.split('?')[0];
}

/**
 * GET /health - Health check endpoint
 */
function handleHealthCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const config = getConvexConfig();
  const tokenProvider = getConvexTokenProvider();
  const stats = tokenProvider.getStats();

  sendJsonSuccess(res, {
    status: 'healthy',
    server: 'google-calendar-mcp',
    mode: config.isEnabled() ? 'convex' : 'standard',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: process.memoryUsage().heapUsed,
      total: process.memoryUsage().heapTotal,
    },
    users: {
      total: stats.totalUsers,
      active: stats.activeUsers,
    },
  });
}

/**
 * GET /metrics - Detailed metrics endpoint
 */
function handleMetrics(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const config = getConvexConfig();
  const tokenProvider = getConvexTokenProvider();
  const stats = tokenProvider.getStats();
  const memoryUsage = process.memoryUsage();

  sendJsonSuccess(res, {
    server: {
      name: 'google-calendar-mcp',
      mode: config.isEnabled() ? 'convex' : 'standard',
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
    },
    tokens: {
      totalUsers: stats.totalUsers,
      activeUsers: stats.activeUsers,
      expiredTokens: stats.expiredTokens,
      oldestTokenAge: stats.oldestToken
        ? Date.now() - stats.oldestToken
        : null,
      newestTokenAge: stats.newestToken
        ? Date.now() - stats.newestToken
        : null,
    },
    memory: {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      rss: memoryUsage.rss,
      arrayBuffers: memoryUsage.arrayBuffers,
    },
    process: {
      pid: process.pid,
      cpuUsage: process.cpuUsage(),
    },
    config: config.isEnabled() ? {
      rateLimits: config.getRateLimitConfig(),
      allowedOrigins: config.getAllowedOrigins(),
      tokenValidation: config.getTokenValidationConfig(),
      cleanup: config.getCleanupConfig(),
    } : null,
  });
}

/**
 * GET /api/users/active - List active users (admin endpoint)
 */
function handleActiveUsers(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const tokenProvider = getConvexTokenProvider();
  const userIds = tokenProvider.getAllUserIds();
  const stats = tokenProvider.getStats();

  const users = userIds.map(userId => {
      const tokens = tokenProvider.getUserTokens(userId);
      if (!tokens) {
        return null;
      }

      const isExpired = tokenProvider.isTokenExpired(tokens);
      const expiresIn = tokens.expiresAt - Date.now();

      return {
        userId,
        valid: !isExpired,
        expiresIn: expiresIn > 0 ? expiresIn : 0,
        scope: tokens.scope,
      };
    })
    .filter(user => user !== null);

  sendJsonSuccess(res, {
    total: stats.totalUsers,
    active: stats.activeUsers,
    expired: stats.expiredTokens,
    users,
  });
}

/**
 * GET /api/config - Get configuration (non-sensitive parts)
 */
function handleGetConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const config = getConvexConfig();

  sendJsonSuccess(res, {
    convexMode: config.isEnabled(),
    rateLimits: config.getRateLimitConfig(),
    allowedOrigins: config.getAllowedOrigins(),
    tokenValidation: config.getTokenValidationConfig(),
    cleanup: config.getCleanupConfig(),
  });
}

/**
 * GET /version - Get server version
 */
function handleVersion(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  // Try to read version from package.json (if available)
  let version = 'unknown';
  try {
    // In production, package.json might not be available
    // This is just for informational purposes
    version = '2.0.6'; // Hardcoded for now, can be dynamic
  } catch (error) {
    // Ignore error
  }

  sendJsonSuccess(res, {
    server: 'google-calendar-mcp',
    version,
    nodeVersion: process.version,
    mcpVersion: '1.12.1', // MCP SDK version
  });
}

/**
 * Main router for management endpoints
 */
export async function handleManagementEndpoints(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const path = parseUrl(req.url);

  // Only GET requests for management endpoints
  if (req.method !== 'GET') {
    return false;
  }

  // Route to appropriate handler
  switch (path) {
    case '/health':
      handleHealthCheck(req, res);
      return true;

    case '/metrics':
      handleMetrics(req, res);
      return true;

    case '/version':
      handleVersion(req, res);
      return true;

    case '/api/config':
      handleGetConfig(req, res);
      return true;

    case '/api/users/active':
      // Admin endpoint - requires API key
      // In a production system, this should have additional admin authorization
      const config = getConvexConfig();
      if (config.isEnabled()) {
        const apiKey = req.headers['x-api-key'] as string ||
                      req.headers['authorization']?.replace('Bearer ', '');

        if (!config.validateApiKey(apiKey)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Unauthorized',
            message: 'Invalid or missing API key',
          }));
          return true;
        }
      }

      handleActiveUsers(req, res);
      return true;

    default:
      return false;
  }
}
