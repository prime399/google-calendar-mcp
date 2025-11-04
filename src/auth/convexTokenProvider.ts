/**
 * ConvexTokenProvider - Multi-tenant token management for Convex integration
 *
 * Manages OAuth tokens for multiple users in memory, designed for
 * deployment on Heroku where tokens are injected from study-flow's
 * Convex database.
 */

import { OAuth2Client, Credentials } from 'google-auth-library';

/**
 * User token data structure matching Convex schema
 */
export interface UserTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scope: string;
  tokenType: string;
}

/**
 * Internal token entry with metadata
 */
interface TokenEntry {
  tokens: UserTokens;
  lastUpdated: number; // Unix timestamp
  lastAccessed: number; // Unix timestamp for cleanup
}

/**
 * Statistics for monitoring
 */
export interface TokenStats {
  totalUsers: number;
  activeUsers: number; // Accessed in last hour
  expiredTokens: number;
  oldestToken: number | null;
  newestToken: number | null;
}

/**
 * ConvexTokenProvider manages OAuth tokens for multiple users
 * in a multi-tenant MCP server environment.
 */
export class ConvexTokenProvider {
  private tokenStore: Map<string, TokenEntry>;
  private cleanupInterval: NodeJS.Timeout | null;
  private readonly CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly STALE_TOKEN_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.tokenStore = new Map();
    this.cleanupInterval = null;
    this.startCleanupScheduler();
  }

  /**
   * Set or update tokens for a user
   */
  setUserTokens(userId: string, tokens: UserTokens): void {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId: must be a non-empty string');
    }

    this.validateTokens(tokens);

    const now = Date.now();
    this.tokenStore.set(userId, {
      tokens,
      lastUpdated: now,
      lastAccessed: now,
    });
  }

  /**
   * Get tokens for a user
   */
  getUserTokens(userId: string): UserTokens | null {
    if (!userId) {
      return null;
    }

    const entry = this.tokenStore.get(userId);
    if (!entry) {
      return null;
    }

    // Update last accessed time
    entry.lastAccessed = Date.now();

    return entry.tokens;
  }

  /**
   * Remove tokens for a user
   */
  removeUserTokens(userId: string): boolean {
    return this.tokenStore.delete(userId);
  }

  /**
   * Check if user has valid (non-expired) tokens
   */
  hasValidTokens(userId: string): boolean {
    const tokens = this.getUserTokens(userId);
    if (!tokens) {
      return false;
    }

    return !this.isTokenExpired(tokens);
  }

  /**
   * Check if tokens are expired
   */
  isTokenExpired(tokens: UserTokens): boolean {
    const now = Date.now();
    // Add 5 minute buffer to prevent edge cases
    const bufferMs = 5 * 60 * 1000;
    return tokens.expiresAt <= (now + bufferMs);
  }

  /**
   * Get all user IDs with stored tokens
   */
  getAllUserIds(): string[] {
    return Array.from(this.tokenStore.keys());
  }

  /**
   * Clear all tokens (use with caution)
   */
  clearAll(): void {
    this.tokenStore.clear();
  }

  /**
   * Get statistics about stored tokens
   */
  getStats(): TokenStats {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    let expiredCount = 0;
    let activeCount = 0;
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const entry of this.tokenStore.values()) {
      // Check if expired
      if (this.isTokenExpired(entry.tokens)) {
        expiredCount++;
      }

      // Check if active (accessed in last hour)
      if (entry.lastAccessed >= oneHourAgo) {
        activeCount++;
      }

      // Track oldest and newest
      if (oldest === null || entry.lastUpdated < oldest) {
        oldest = entry.lastUpdated;
      }
      if (newest === null || entry.lastUpdated > newest) {
        newest = entry.lastUpdated;
      }
    }

    return {
      totalUsers: this.tokenStore.size,
      activeUsers: activeCount,
      expiredTokens: expiredCount,
      oldestToken: oldest,
      newestToken: newest,
    };
  }

  /**
   * Create OAuth2Client with user-specific tokens
   */
  createOAuth2ClientForUser(
    userId: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): OAuth2Client | null {
    const tokens = this.getUserTokens(userId);
    if (!tokens) {
      return null;
    }

    const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

    // Convert to google-auth-library Credentials format
    const credentials: Credentials = {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt,
      scope: tokens.scope,
      token_type: tokens.tokenType,
    };

    oauth2Client.setCredentials(credentials);
    return oauth2Client;
  }

  /**
   * Validate token structure
   */
  private validateTokens(tokens: UserTokens): void {
    if (!tokens.accessToken || typeof tokens.accessToken !== 'string') {
      throw new Error('Invalid accessToken: must be a non-empty string');
    }

    if (!tokens.refreshToken || typeof tokens.refreshToken !== 'string') {
      throw new Error('Invalid refreshToken: must be a non-empty string');
    }

    if (!tokens.expiresAt || typeof tokens.expiresAt !== 'number') {
      throw new Error('Invalid expiresAt: must be a number');
    }

    if (!tokens.scope || typeof tokens.scope !== 'string') {
      throw new Error('Invalid scope: must be a string');
    }

    if (!tokens.tokenType || typeof tokens.tokenType !== 'string') {
      throw new Error('Invalid tokenType: must be a string');
    }
  }

  /**
   * Start automatic cleanup of stale tokens
   */
  private startCleanupScheduler(): void {
    // Clean up immediately on start
    this.cleanupStaleTokens();

    // Then schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleTokens();
    }, this.CLEANUP_INTERVAL_MS);

    // Ensure cleanup runs on process exit
    process.on('SIGTERM', () => this.stopCleanupScheduler());
    process.on('SIGINT', () => this.stopCleanupScheduler());
  }

  /**
   * Stop cleanup scheduler
   */
  private stopCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Remove stale tokens that haven't been accessed recently
   * This prevents memory leaks from inactive users
   */
  private cleanupStaleTokens(): void {
    const now = Date.now();
    const threshold = now - this.STALE_TOKEN_THRESHOLD_MS;

    let removedCount = 0;

    for (const [userId, entry] of this.tokenStore.entries()) {
      // Remove if not accessed in threshold period
      if (entry.lastAccessed < threshold) {
        this.tokenStore.delete(userId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`[ConvexTokenProvider] Cleaned up ${removedCount} stale token entries`);
    }
  }

  /**
   * Get cleanup configuration
   */
  getCleanupConfig() {
    return {
      intervalMs: this.CLEANUP_INTERVAL_MS,
      staleThresholdMs: this.STALE_TOKEN_THRESHOLD_MS,
      isRunning: this.cleanupInterval !== null,
    };
  }
}

// Singleton instance for the application
let instance: ConvexTokenProvider | null = null;

/**
 * Get or create the singleton ConvexTokenProvider instance
 */
export function getConvexTokenProvider(): ConvexTokenProvider {
  if (!instance) {
    instance = new ConvexTokenProvider();
  }
  return instance;
}

/**
 * Reset the singleton instance (mainly for testing)
 */
export function resetConvexTokenProvider(): void {
  instance = null;
}
