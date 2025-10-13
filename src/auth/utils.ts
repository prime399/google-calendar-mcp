import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { getSecureTokenPath as getSharedSecureTokenPath, getLegacyTokenPath as getSharedLegacyTokenPath, getAccountMode as getSharedAccountMode } from './paths.js';

// Helper to get the project root directory reliably
function getProjectRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // In build output (e.g., build/bundle.js), __dirname is .../build
  // Go up ONE level to get the project root
  const projectRoot = path.join(__dirname, ".."); // Corrected: Go up ONE level
  return path.resolve(projectRoot); // Ensure absolute path
}

// Get the current account mode (normal or test) - delegates to shared implementation
export function getAccountMode(): 'normal' | 'test' {
  return getSharedAccountMode() as 'normal' | 'test';
}

// Helper to detect if we're running in a test environment
function isRunningInTestEnvironment(): boolean {
  // Simple and reliable: just check NODE_ENV
  return process.env.NODE_ENV === 'test';
}

// Returns the absolute path for the saved token file - delegates to shared implementation
export function getSecureTokenPath(): string {
  return getSharedSecureTokenPath();
}

// Returns the legacy token path for backward compatibility - delegates to shared implementation  
export function getLegacyTokenPath(): string {
  return getSharedLegacyTokenPath();
}

// Returns the absolute path for the GCP OAuth keys file with priority:
// 1. Environment variable GOOGLE_OAUTH_CREDENTIALS (highest priority)
// 2. Default file path (lowest priority)
export function getKeysFilePath(): string {
  // Priority 1: Environment variable
  const envCredentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS;
  if (envCredentialsPath) {
    return path.resolve(envCredentialsPath);
  }
  
  // Priority 2: Default file path
  const projectRoot = getProjectRoot();
  const keysPath = path.join(projectRoot, "gcp-oauth.keys.json");
  return keysPath; // Already absolute from getProjectRoot
}

// Helper to determine if we're currently in test mode
export function isTestMode(): boolean {
  return getAccountMode() === 'test';
}

// Interface for OAuth credentials
export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

// Interface for credentials file with project_id
export interface OAuthCredentialsWithProject {
  installed?: {
    project_id?: string;
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  project_id?: string;
  client_id?: string;
  client_secret?: string;
  redirect_uris?: string[];
}

// Get project ID from OAuth credentials file
// Returns undefined if credentials file doesn't exist, is invalid, or missing project_id
export function getCredentialsProjectId(): string | undefined {
  try {
    // Use existing helper to get credentials file path
    const credentialsPath = getKeysFilePath();

    if (!fs.existsSync(credentialsPath)) {
      return undefined;
    }

    const credentialsContent = fs.readFileSync(credentialsPath, 'utf-8');
    const credentials: OAuthCredentialsWithProject = JSON.parse(credentialsContent);

    // Extract project_id from installed format or direct format
    if (credentials.installed?.project_id) {
      return credentials.installed.project_id;
    } else if (credentials.project_id) {
      return credentials.project_id;
    }

    return undefined;
  } catch (error) {
    // If we can't read project ID, return undefined (backward compatibility)
    return undefined;
  }
}

// Generate helpful error message for missing credentials
export function generateCredentialsErrorMessage(): string {
  return `
OAuth credentials not found. Please provide credentials using one of these methods:

1. Environment variable:
   Set GOOGLE_OAUTH_CREDENTIALS to the path of your credentials file:
   export GOOGLE_OAUTH_CREDENTIALS="/path/to/gcp-oauth.keys.json"

2. Default file path:
   Place your gcp-oauth.keys.json file in the package root directory.

Token storage:
- Tokens are saved to: ${getSecureTokenPath()}
- To use a custom token location, set GOOGLE_CALENDAR_MCP_TOKEN_PATH environment variable

To get OAuth credentials:
1. Go to the Google Cloud Console (https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials
5. Download the credentials file as gcp-oauth.keys.json
`.trim();
}

// Get OAuth callback host from environment or default to localhost
export function getOAuthCallbackHost(): string {
  return process.env.OAUTH_CALLBACK_HOST || 'localhost';
}

// Get OAuth callback port from environment or return undefined for auto-detection
export function getOAuthCallbackPort(): number | undefined {
  const port = process.env.OAUTH_CALLBACK_PORT;
  if (port && port.trim() !== '') {
    // Validate that the string is purely numeric before parsing
    if (!/^\d+$/.test(port.trim())) {
      throw new Error(`Invalid OAUTH_CALLBACK_PORT: ${port}. Must be between 1 and 65535.`);
    }
    const parsed = parseInt(port, 10);
    if (parsed < 1 || parsed > 65535) {
      throw new Error(`Invalid OAUTH_CALLBACK_PORT: ${port}. Must be between 1 and 65535.`);
    }
    return parsed;
  }
  return undefined; // Use default port range
}

// Validate and provide setup instructions for remote OAuth
export function validateOAuthCallbackConfig(actualPort: number): void {
  const host = getOAuthCallbackHost();
  const configuredPort = getOAuthCallbackPort();

  // Log configuration source
  const portSource = configuredPort ? 'OAUTH_CALLBACK_PORT env var' : 'auto-detected';
  process.stderr.write(`\n📋 OAuth Configuration:\n`);
  process.stderr.write(`   Host: ${host} ${host === 'localhost' ? '(default)' : '(OAUTH_CALLBACK_HOST)'}\n`);
  process.stderr.write(`   Port: ${actualPort} (${portSource})\n`);

  // For remote hosts, show required Google Console setup
  if (host !== 'localhost' && host !== '127.0.0.1') {
    const callbackUrl = `http://${host}:${actualPort}/oauth2callback`;
    process.stderr.write(`\n⚠️  REMOTE HOST DETECTED - SETUP REQUIRED:\n`);
    process.stderr.write(`\n`);
    process.stderr.write(`   Before authenticating, add this redirect URI to Google Cloud Console:\n`);
    process.stderr.write(`   \n`);
    process.stderr.write(`   ${callbackUrl}\n`);
    process.stderr.write(`   \n`);
    process.stderr.write(`   Steps:\n`);
    process.stderr.write(`   1. Visit: https://console.cloud.google.com/apis/credentials\n`);
    process.stderr.write(`   2. Select your OAuth 2.0 Client ID\n`);
    process.stderr.write(`   3. Add the URI above to "Authorized redirect URIs"\n`);
    process.stderr.write(`   4. Save and return here to continue\n`);
    process.stderr.write(`\n`);
    process.stderr.write(`   If you haven't configured your firewall:\n`);
    process.stderr.write(`   - Ensure port ${actualPort} is accessible from your local machine\n`);
    process.stderr.write(`   - Test with: curl http://${host}:${actualPort}\n`);
    process.stderr.write(`\n`);
    process.stderr.write(`   Alternative: Use SSH tunneling to avoid firewall configuration:\n`);
    process.stderr.write(`   - Run: ssh -L ${actualPort}:localhost:${actualPort} user@${host}\n`);
    process.stderr.write(`   - Then use OAUTH_CALLBACK_HOST=localhost\n`);
    process.stderr.write(`\n`);
  }
}

// Detect common typos in environment variables
export function detectConfigTypos(): void {
  const possibleTypos = [
    'OAUTH_CALLBAK_HOST',
    'OAUTH_CALLBACK_HST',
    'OAUTH_CALLBAK_PORT',
    'OAUTH_CALLBACK_PRT',
  ];

  for (const typo of possibleTypos) {
    if (process.env[typo]) {
      process.stderr.write(`⚠️  Warning: Found '${typo}' in environment. Did you mean '${typo.replace('CALLBAK', 'CALLBACK').replace('HST', 'HOST').replace('PRT', 'PORT')}'?\n`);
    }
  }
}
