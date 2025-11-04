/**
 * Token Management API Endpoints
 *
 * Handles token injection, status checking, and removal for Convex integration
 */

import http from 'http';
import { z } from 'zod';
import { getConvexTokenProvider, UserTokens } from '../auth/convexTokenProvider.js';
import { getConvexConfig } from '../config/ConvexConfig.js';
import {
  parseJsonBody,
  sendJsonError,
  sendJsonSuccess,
  apiKeyAuth,
  rateLimitTokenInjection,
  composeMiddleware,
} from '../middleware/auth.js';

/**
 * Schema for token injection request
 */
const InjectTokensSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  accessToken: z.string().min(1, 'accessToken is required'),
  refreshToken: z.string().min(1, 'refreshToken is required'),
  expiresAt: z.number().int().positive('expiresAt must be a positive integer'),
  scope: z.string().min(1, 'scope is required'),
  tokenType: z.string().min(1, 'tokenType is required'),
});

/**
 * Parse URL and extract path and parameters
 */
function parseUrl(url: string = '/'): { path: string; params: Record<string, string> } {
  const [path, query] = url.split('?');
  const params: Record<string, string> = {};

  if (query) {
    const searchParams = new URLSearchParams(query);
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
  }

  return { path, params };
}

/**
 * Extract userId from URL path like /api/tokens/:userId
 */
function extractUserId(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) {
    return null;
  }

  const userId = path.slice(prefix.length).split('/')[0];
  return userId || null;
}

/**
 * POST /api/tokens - Inject or update user tokens
 */
async function handleInjectTokens(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // Parse request body
    const body = await parseJsonBody(req);

    // Validate request body
    const validation = InjectTokensSchema.safeParse(body);
    if (!validation.success) {
      return sendJsonError(
        res,
        400,
        'Validation Error',
        validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      );
    }

    const data = validation.data;

    // Check token expiry
    const config = getConvexConfig();
    const tokenValidation = config.getTokenValidationConfig();
    const now = Date.now();
    const timeUntilExpiry = data.expiresAt - now;

    // Reject if already expired
    if (timeUntilExpiry <= 0) {
      return sendJsonError(
        res,
        400,
        'Invalid Token',
        'Token has already expired. Please refresh the token before injecting.'
      );
    }

    // Reject if expires too soon
    if (timeUntilExpiry < tokenValidation.minExpiryBufferMs) {
      const minutesRemaining = Math.ceil(timeUntilExpiry / 60000);
      return sendJsonError(
        res,
        400,
        'Token Expiring Soon',
        `Token expires in ${minutesRemaining} minutes. Please refresh before injecting.`
      );
    }

    // Warn if expires within warning threshold
    let warningMessage: string | undefined;
    if (timeUntilExpiry < tokenValidation.expiryWarningThresholdMs) {
      const minutesRemaining = Math.ceil(timeUntilExpiry / 60000);
      warningMessage = `Token will expire in ${minutesRemaining} minutes. Consider refreshing soon.`;
    }

    // Store tokens
    const tokenProvider = getConvexTokenProvider();
    const userTokens: UserTokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      scope: data.scope,
      tokenType: data.tokenType,
    };

    tokenProvider.setUserTokens(data.userId, userTokens);

    // Return success
    sendJsonSuccess(res, {
      success: true,
      message: 'Tokens injected successfully',
      userId: data.userId,
      expiresAt: data.expiresAt,
      expiresIn: timeUntilExpiry,
      warning: warningMessage,
    }, 200);

  } catch (error) {
    console.error('[TokenEndpoints] Error injecting tokens:', error);

    if (error instanceof Error && error.message === 'Invalid JSON body') {
      return sendJsonError(res, 400, 'Bad Request', 'Invalid JSON in request body');
    }

    return sendJsonError(res, 500, 'Internal Server Error', 'Failed to inject tokens');
  }
}

/**
 * GET /api/tokens/:userId/status - Check token status
 */
async function handleTokenStatus(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  userId: string
): Promise<void> {
  try {
    const tokenProvider = getConvexTokenProvider();

    // Check if user has tokens
    const tokens = tokenProvider.getUserTokens(userId);
    if (!tokens) {
      return sendJsonSuccess(res, {
        userId,
        hasTokens: false,
        valid: false,
        message: 'No tokens found for user',
      });
    }

    // Check if tokens are valid
    const isExpired = tokenProvider.isTokenExpired(tokens);
    const now = Date.now();
    const expiresIn = tokens.expiresAt - now;

    sendJsonSuccess(res, {
      userId,
      hasTokens: true,
      valid: !isExpired,
      expiresAt: tokens.expiresAt,
      expiresIn: expiresIn > 0 ? expiresIn : 0,
      expired: isExpired,
      scope: tokens.scope,
    });

  } catch (error) {
    console.error('[TokenEndpoints] Error checking token status:', error);
    return sendJsonError(res, 500, 'Internal Server Error', 'Failed to check token status');
  }
}

/**
 * DELETE /api/tokens/:userId - Remove user tokens
 */
async function handleDeleteTokens(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  userId: string
): Promise<void> {
  try {
    const tokenProvider = getConvexTokenProvider();

    // Check if user has tokens
    const hadTokens = tokenProvider.getUserTokens(userId) !== null;

    // Remove tokens
    tokenProvider.removeUserTokens(userId);

    sendJsonSuccess(res, {
      success: true,
      userId,
      message: hadTokens
        ? 'Tokens removed successfully'
        : 'No tokens found for user (already removed)',
    });

  } catch (error) {
    console.error('[TokenEndpoints] Error deleting tokens:', error);
    return sendJsonError(res, 500, 'Internal Server Error', 'Failed to delete tokens');
  }
}

/**
 * Main router for token management endpoints
 */
export async function handleTokenEndpoints(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const { path } = parseUrl(req.url);

  // Only handle /api/tokens/* endpoints
  if (!path.startsWith('/api/tokens')) {
    return false;
  }

  // Apply authentication middleware
  const authMiddleware = composeMiddleware(
    apiKeyAuth(),
    rateLimitTokenInjection()
  );

  // Wrap middleware execution in promise
  const authenticated = await new Promise<boolean>((resolve) => {
    authMiddleware(req, res, () => resolve(true));
    // If response was sent by middleware (auth failed), resolve false
    res.on('finish', () => {
      if (res.headersSent) {
        resolve(false);
      }
    });
  });

  // If authentication failed, middleware already sent response
  if (!authenticated || res.headersSent) {
    return true;
  }

  // Route to appropriate handler
  if (req.method === 'POST' && path === '/api/tokens') {
    await handleInjectTokens(req, res);
    return true;
  }

  if (req.method === 'GET' && path.startsWith('/api/tokens/')) {
    const userId = extractUserId(path, '/api/tokens/');
    if (userId && path === `/api/tokens/${userId}/status`) {
      await handleTokenStatus(req, res, userId);
      return true;
    }
  }

  if (req.method === 'DELETE' && path.startsWith('/api/tokens/')) {
    const userId = extractUserId(path, '/api/tokens/');
    if (userId) {
      await handleDeleteTokens(req, res, userId);
      return true;
    }
  }

  // Endpoint not found
  sendJsonError(res, 404, 'Not Found', 'Token endpoint not found');
  return true;
}
