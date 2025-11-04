/**
 * ConvexConfig - Configuration for Convex integration mode
 *
 * This configuration is used when the MCP server is deployed on Heroku
 * and integrates with study-flow's Convex-based authentication.
 */

/**
 * Convex integration configuration
 */
export interface ConvexConfigOptions {
  // Enable Convex integration mode
  enabled: boolean;

  // API key for authenticating token injection requests
  apiKey: string;

  // Allowed origins for CORS (study-flow domains)
  allowedOrigins: string[];

  // Rate limiting configuration
  rateLimit: {
    // Max requests per window per user
    maxRequestsPerUser: number;
    // Max token injections per window per IP
    maxTokenInjectionsPerIp: number;
    // Time window in milliseconds
    windowMs: number;
  };

  // Token validation settings
  tokenValidation: {
    // Minimum token expiry buffer (ms)
    minExpiryBufferMs: number;
    // Warn if token expires in less than this (ms)
    expiryWarningThresholdMs: number;
  };

  // Cleanup settings
  cleanup: {
    // How often to run cleanup (ms)
    intervalMs: number;
    // Remove tokens not accessed in this time (ms)
    staleThresholdMs: number;
  };
}

/**
 * ConvexConfig class for managing Convex integration settings
 */
export class ConvexConfig {
  private config: ConvexConfigOptions;

  constructor() {
    this.config = this.loadFromEnvironment();
    this.validate();
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): ConvexConfigOptions {
    // Check if Convex mode is enabled
    const enabled = process.env.CONVEX_MODE === 'true';

    // API key for authentication (required in Convex mode)
    const apiKey = process.env.MCP_API_KEY || '';

    // Parse allowed origins (comma-separated)
    const allowedOriginsStr = process.env.ALLOWED_ORIGINS || '';
    const allowedOrigins = allowedOriginsStr
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);

    // Rate limiting settings
    const maxRequestsPerUser = parseInt(
      process.env.RATE_LIMIT_REQUESTS_PER_USER || '100',
      10
    );
    const maxTokenInjectionsPerIp = parseInt(
      process.env.RATE_LIMIT_TOKEN_INJECTIONS_PER_IP || '10',
      10
    );
    const rateLimitWindowMs = parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), // 15 minutes
      10
    );

    // Token validation settings
    const minExpiryBufferMs = parseInt(
      process.env.TOKEN_MIN_EXPIRY_BUFFER_MS || String(5 * 60 * 1000), // 5 minutes
      10
    );
    const expiryWarningThresholdMs = parseInt(
      process.env.TOKEN_EXPIRY_WARNING_MS || String(10 * 60 * 1000), // 10 minutes
      10
    );

    // Cleanup settings
    const cleanupIntervalMs = parseInt(
      process.env.CLEANUP_INTERVAL_MS || String(30 * 60 * 1000), // 30 minutes
      10
    );
    const staleThresholdMs = parseInt(
      process.env.CLEANUP_STALE_THRESHOLD_MS || String(24 * 60 * 60 * 1000), // 24 hours
      10
    );

    return {
      enabled,
      apiKey,
      allowedOrigins,
      rateLimit: {
        maxRequestsPerUser,
        maxTokenInjectionsPerIp,
        windowMs: rateLimitWindowMs,
      },
      tokenValidation: {
        minExpiryBufferMs,
        expiryWarningThresholdMs,
      },
      cleanup: {
        intervalMs: cleanupIntervalMs,
        staleThresholdMs,
      },
    };
  }

  /**
   * Validate configuration
   */
  private validate(): void {
    if (!this.config.enabled) {
      // Convex mode not enabled, no validation needed
      return;
    }

    // API key is required in Convex mode
    if (!this.config.apiKey || this.config.apiKey.length < 32) {
      throw new Error(
        'MCP_API_KEY must be set and at least 32 characters long when CONVEX_MODE is enabled'
      );
    }

    // At least one allowed origin should be specified
    if (this.config.allowedOrigins.length === 0) {
      console.warn(
        '[ConvexConfig] Warning: No ALLOWED_ORIGINS specified. CORS will block all cross-origin requests.'
      );
    }

    // Validate rate limit values
    if (this.config.rateLimit.maxRequestsPerUser <= 0) {
      throw new Error('RATE_LIMIT_REQUESTS_PER_USER must be greater than 0');
    }

    if (this.config.rateLimit.maxTokenInjectionsPerIp <= 0) {
      throw new Error('RATE_LIMIT_TOKEN_INJECTIONS_PER_IP must be greater than 0');
    }

    if (this.config.rateLimit.windowMs <= 0) {
      throw new Error('RATE_LIMIT_WINDOW_MS must be greater than 0');
    }

    // Log configuration summary
    console.log('[ConvexConfig] Convex integration mode enabled');
    console.log(`[ConvexConfig] Allowed origins: ${this.config.allowedOrigins.join(', ')}`);
    console.log(`[ConvexConfig] Rate limit: ${this.config.rateLimit.maxRequestsPerUser} requests per user per ${this.config.rateLimit.windowMs}ms`);
  }

  /**
   * Check if Convex mode is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get API key
   */
  getApiKey(): string {
    return this.config.apiKey;
  }

  /**
   * Get allowed origins for CORS
   */
  getAllowedOrigins(): string[] {
    return this.config.allowedOrigins;
  }

  /**
   * Get rate limit configuration
   */
  getRateLimitConfig() {
    return this.config.rateLimit;
  }

  /**
   * Get token validation configuration
   */
  getTokenValidationConfig() {
    return this.config.tokenValidation;
  }

  /**
   * Get cleanup configuration
   */
  getCleanupConfig() {
    return this.config.cleanup;
  }

  /**
   * Validate API key
   */
  validateApiKey(providedKey: string): boolean {
    if (!this.config.enabled) {
      return true; // No validation needed in non-Convex mode
    }

    // Use constant-time comparison to prevent timing attacks
    if (providedKey.length !== this.config.apiKey.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < providedKey.length; i++) {
      result |= providedKey.charCodeAt(i) ^ this.config.apiKey.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Check if origin is allowed
   */
  isOriginAllowed(origin: string): boolean {
    if (!this.config.enabled) {
      return true; // Allow all in non-Convex mode
    }

    // If no origins specified, deny all
    if (this.config.allowedOrigins.length === 0) {
      return false;
    }

    // Check for wildcard
    if (this.config.allowedOrigins.includes('*')) {
      return true;
    }

    // Check for exact match
    return this.config.allowedOrigins.includes(origin);
  }

  /**
   * Get full configuration (for debugging/monitoring)
   */
  getConfig(): ConvexConfigOptions {
    // Return a copy to prevent modification
    return JSON.parse(JSON.stringify(this.config));
  }
}

// Singleton instance
let instance: ConvexConfig | null = null;

/**
 * Get or create the singleton ConvexConfig instance
 */
export function getConvexConfig(): ConvexConfig {
  if (!instance) {
    instance = new ConvexConfig();
  }
  return instance;
}

/**
 * Reset the singleton instance (mainly for testing)
 */
export function resetConvexConfig(): void {
  instance = null;
}

/**
 * Helper to generate a secure API key (for setup)
 */
export function generateApiKey(length: number = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  const randomValues = new Uint8Array(length);

  // Use crypto for secure random generation
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    // Fallback for Node.js
    const cryptoNode = require('crypto');
    for (let i = 0; i < length; i++) {
      randomValues[i] = cryptoNode.randomBytes(1)[0];
    }
  }

  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }

  return result;
}
