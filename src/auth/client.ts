import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import { getKeysFilePath, generateCredentialsErrorMessage, OAuthCredentials } from './utils.js';
import { getConvexTokenProvider } from './convexTokenProvider.js';
import { getConvexConfig } from '../config/ConvexConfig.js';

async function loadCredentialsFromFile(): Promise<OAuthCredentials> {
  const keysContent = await fs.readFile(getKeysFilePath(), "utf-8");
  const keys = JSON.parse(keysContent);

  if (keys.installed) {
    // Standard OAuth credentials file format
    const { client_id, client_secret, redirect_uris } = keys.installed;
    return { client_id, client_secret, redirect_uris };
  } else if (keys.client_id && keys.client_secret) {
    // Direct format
    return {
      client_id: keys.client_id,
      client_secret: keys.client_secret,
      redirect_uris: keys.redirect_uris || ['http://localhost:3000/oauth2callback']
    };
  } else {
    throw new Error('Invalid credentials file format. Expected either "installed" object or direct client_id/client_secret fields.');
  }
}

async function loadCredentialsWithFallback(): Promise<OAuthCredentials> {
  // Load credentials from file (CLI param, env var, or default path)
  try {
    return await loadCredentialsFromFile();
  } catch (fileError) {
    // Generate helpful error message
    const errorMessage = generateCredentialsErrorMessage();
    throw new Error(`${errorMessage}\n\nOriginal error: ${fileError instanceof Error ? fileError.message : fileError}`);
  }
}

export async function initializeOAuth2Client(): Promise<OAuth2Client> {
  // Always use real OAuth credentials - no mocking.
  // Unit tests should mock at the handler level, integration tests need real credentials.
  try {
    const credentials = await loadCredentialsWithFallback();
    
    // Use the first redirect URI as the default for the base client
    return new OAuth2Client({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      redirectUri: credentials.redirect_uris[0],
    });
  } catch (error) {
    throw new Error(`Error loading OAuth keys: ${error instanceof Error ? error.message : error}`);
  }
}

export async function loadCredentials(): Promise<{ client_id: string; client_secret: string }> {
  try {
    const credentials = await loadCredentialsWithFallback();

    if (!credentials.client_id || !credentials.client_secret) {
        throw new Error('Client ID or Client Secret missing in credentials.');
    }
    return {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret
    };
  } catch (error) {
    throw new Error(`Error loading credentials: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Get OAuth2Client for a specific user in Convex mode
 * This function retrieves user-specific tokens from ConvexTokenProvider
 * and creates an OAuth2Client with those tokens
 */
export async function getOAuth2ClientForUser(userId: string): Promise<OAuth2Client | null> {
  const config = getConvexConfig();

  if (!config.isEnabled()) {
    throw new Error('getOAuth2ClientForUser can only be used in Convex mode');
  }

  const tokenProvider = getConvexTokenProvider();
  const credentials = await loadCredentials();

  // Create OAuth2Client with user-specific tokens
  const oauth2Client = tokenProvider.createOAuth2ClientForUser(
    userId,
    credentials.client_id,
    credentials.client_secret,
    'http://localhost' // Redirect URI not used for token-injected clients
  );

  return oauth2Client;
}

/**
 * Check if a user has valid tokens in Convex mode
 */
export function hasValidTokensForUser(userId: string): boolean {
  const tokenProvider = getConvexTokenProvider();
  return tokenProvider.hasValidTokens(userId);
}

/**
 * Get all user IDs with stored tokens in Convex mode
 */
export function getAllUserIds(): string[] {
  const tokenProvider = getConvexTokenProvider();
  return tokenProvider.getAllUserIds();
}

/**
 * Initialize OAuth2Client with fallback for Convex mode
 * In Convex mode, OAuth credentials are still needed but actual user tokens
 * are managed separately via ConvexTokenProvider
 */
export async function initializeOAuth2ClientForConvex(): Promise<{ clientId: string; clientSecret: string }> {
  const config = getConvexConfig();

  if (!config.isEnabled()) {
    throw new Error('initializeOAuth2ClientForConvex should only be used in Convex mode');
  }

  // In Convex mode, we still need OAuth credentials (client_id, client_secret)
  // but we don't create a shared OAuth2Client instance
  try {
    // Try to load from environment variables first (for Heroku deployment)
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }

    // Fallback to credentials file
    const credentials = await loadCredentials();
    return {
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
    };
  } catch (error) {
    throw new Error(`Error loading OAuth credentials for Convex mode: ${error instanceof Error ? error.message : error}`);
  }
}