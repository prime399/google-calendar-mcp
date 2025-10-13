# Remote Host OAuth Implementation Strategy

**Issue**: [#96 - Make callback url changeable to allow configuration on remote host](https://github.com/nspady/google-calendar-mcp/issues/96)

## Problem Summary

When running the MCP server in a Docker container on a remote host, the OAuth callback currently hardcodes `localhost` which causes authentication to fail. Users authenticate from their local browser but the callback redirects to `http://localhost:3500/oauth2callback` (the remote host) instead of the correct remote host address.

## Critical Risks & Mitigations

### 1. Google OAuth Redirect URI Whitelist ⚠️ HIGHEST RISK
**Risk**: Google rejects callbacks to URIs not pre-configured in Cloud Console.
**Mitigation**:
- Add pre-flight validation that displays required redirect URI before starting auth
- Show actionable error with Google Console link when validation detects remote host
- Make this step 1 in documentation, not buried in troubleshooting

### 2. Docker Port Mapping Confusion ⚠️ HIGH RISK
**Risk**: Users confuse container-internal ports with host-exposed ports.
**Mitigation**:
- Use clear naming: `OAUTH_CALLBACK_PORT` explicitly refers to "externally accessible port"
- Add startup logging showing: "OAuth server listening internally on :3500, accessible externally at <host>:<port>"
- Validate docker-compose port mapping matches configured callback port

### 3. Network/Firewall Accessibility ⚠️ HIGH RISK
**Risk**: Browser cannot reach remote host callback URL due to firewall/NAT.
**Mitigation**:
- Add pre-flight connectivity check: attempt to bind and verify external accessibility
- Provide clear testing commands before authentication
- Prominently suggest SSH tunneling as simpler alternative (no firewall changes needed)

### 4. device_name/device_id Requirements ⚠️ MEDIUM RISK
**Risk**: Google may require these parameters for IP-based callbacks (unclear from issue).
**Mitigation**:
- Research and test during implementation phase
- If required, add optional env vars: `OAUTH_DEVICE_NAME` and `OAUTH_DEVICE_ID`
- Document when/why these are needed based on testing results
- Phase 1: Ship without these, add if users report issues

### 5. Silent Configuration Failures ⚠️ MEDIUM RISK
**Risk**: Typos in env vars or port conflicts cause silent fallback to localhost.
**Mitigation**:
- Log all configuration at startup with source (env var vs default)
- Fail fast if `OAUTH_CALLBACK_PORT` is set but unavailable (don't silently try other ports)
- Detect common typos and suggest correct variable names

## Current Architecture

- **Auth flow**: [src/auth/server.ts:176-181](../src/auth/server.ts#L176-L181) creates OAuth2Client with hardcoded `http://localhost:${port}/oauth2callback`
- **Port range**: Defaults to 3500-3505, defined at [src/auth/server.ts:21](../src/auth/server.ts#L21)
- **Credentials**: No redirect URI configuration currently used from OAuth credentials file

## Proposed Solution

### 1. Environment Variable Configuration

```bash
# OAuth callback configuration (for remote/Docker deployments)
OAUTH_CALLBACK_HOST=localhost  # Set to server IP for remote deployments
OAUTH_CALLBACK_PORT=3500       # External port accessible from browser
```

### 2. Implementation Changes

#### A. Update `src/auth/utils.ts`

```typescript
// Get OAuth callback host from environment or default to localhost
export function getOAuthCallbackHost(): string {
  return process.env.OAUTH_CALLBACK_HOST || 'localhost';
}

// Get OAuth callback port from environment or return undefined for auto-detection
export function getOAuthCallbackPort(): number | undefined {
  const port = process.env.OAUTH_CALLBACK_PORT;
  if (port) {
    const parsed = parseInt(port, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
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
```

#### B. Update `src/auth/server.ts`

**Constructor changes (line 18-22):**

```typescript
constructor(oauth2Client: OAuth2Client) {
  this.baseOAuth2Client = oauth2Client;
  this.tokenManager = new TokenManager(oauth2Client);

  // Detect configuration typos early
  detectConfigTypos();

  // Use configured port or default range
  const configuredPort = getOAuthCallbackPort();
  if (configuredPort) {
    this.portRange = { start: configuredPort, end: configuredPort };
  } else {
    this.portRange = { start: 3500, end: 3505 };
  }
}
```

**OAuth2Client initialization (lines 175-187):**

```typescript
// Successfully started server on `port`. Now create the flow-specific OAuth client.
try {
  const { client_id, client_secret } = await loadCredentials();
  const callbackHost = getOAuthCallbackHost();
  const callbackUrl = `http://${callbackHost}:${port}/oauth2callback`;

  this.flowOAuth2Client = new OAuth2Client(
    client_id,
    client_secret,
    callbackUrl
  );

  // Show configuration and setup instructions
  validateOAuthCallbackConfig(port);
} catch (error) {
  // Could not load credentials, cannot proceed with auth flow
  this.authCompletedSuccessfully = false;
  await this.stop(); // Stop the server we just started
  return false;
}
```

**Update console output (lines 196-198):**

```typescript
const callbackHost = getOAuthCallbackHost();

// Always show the URL in console for easy access
process.stderr.write(`\n🔗 Authentication URL: ${authorizeUrl}\n\n`);
process.stderr.write(`Or visit: http://${callbackHost}:${port}\n\n`);
```

**Add port conflict detection:**

```typescript
private async startServerOnAvailablePort(): Promise<number | null> {
  const configuredPort = getOAuthCallbackPort();

  for (let port = this.portRange.start; port <= this.portRange.end; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const testServer = this.createServer();
        testServer.listen(port, () => {
          this.server = testServer;
          resolve();
        });
        testServer.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            testServer.close(() => reject(err));
          } else {
            reject(err);
          }
        });
      });
      return port; // Port successfully bound
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) {
        return null;
      }

      // If specific port was requested and it's in use, fail immediately
      if (configuredPort) {
        process.stderr.write(`\n❌ Error: Configured port ${configuredPort} is already in use.\n`);
        process.stderr.write(`   Either:\n`);
        process.stderr.write(`   - Stop the process using port ${configuredPort}, or\n`);
        process.stderr.write(`   - Choose a different port with OAUTH_CALLBACK_PORT\n\n`);
        return null;
      }
      // Otherwise continue trying ports in range
    }
  }
  return null; // No port found
}
```

### 3. Docker Deployment Updates

#### Update `docs/docker.md`

Add new section prominently placed:

```markdown
## Remote Host Authentication (Docker on Remote Server)

### Quick Start

**Recommended: SSH Tunneling** (no firewall changes needed)

```bash
# On your local machine, create SSH tunnel to remote server
ssh -L 3500:localhost:3500 user@remote-server

# In another terminal, trigger authentication
docker compose exec calendar-mcp npm run auth

# Visit the localhost URL shown - traffic tunnels through SSH
```

**Alternative: Direct IP Access** (requires firewall configuration)

```bash
# 1. Configure remote host IP
echo "OAUTH_CALLBACK_HOST=192.168.1.100" >> .env
echo "OAUTH_CALLBACK_PORT=3500" >> .env

# 2. Ensure port 3500 is accessible from your local machine
# Test: curl http://192.168.1.100:3500

# 3. Add redirect URI to Google Cloud Console
# Visit: https://console.cloud.google.com/apis/credentials
# Add: http://192.168.1.100:3500/oauth2callback

# 4. Run authentication
docker compose exec calendar-mcp npm run auth
```

### Port Mapping Note

The `OAUTH_CALLBACK_PORT` must match the **host port** in docker-compose.yml:

```yaml
ports:
  - "3500:3500"  # ✅ Host:Container - use OAUTH_CALLBACK_PORT=3500
  - "8500:3500"  # ❌ If using this, set OAUTH_CALLBACK_PORT=8500
```

### Troubleshooting

**"redirect_uri_mismatch" error**
→ The redirect URI isn't whitelisted in Google Cloud Console. Follow setup instructions shown by `npm run auth`.

**"Connection refused" during callback**
→ Port isn't accessible. Test with `curl http://YOUR_IP:3500` from local machine. Consider using SSH tunneling instead.

**"Port already in use"**
→ Another process is using the port. Change `OAUTH_CALLBACK_PORT` or stop the conflicting process.
```

#### Update `.env.example`

```bash
# OAuth Callback Configuration
# For local development: leave as localhost (default)
# For remote Docker: set to server's IP address OR use SSH tunneling (recommended)
OAUTH_CALLBACK_HOST=localhost

# External port accessible from your browser (must match docker-compose.yml host port)
# Leave unset to auto-detect from range 3500-3505
# OAUTH_CALLBACK_PORT=3500
```

### 4. Implementation Checklist

**Phase 1: Core Functionality**
- [ ] Add helper functions to `src/auth/utils.ts`
  - [ ] `getOAuthCallbackHost()`
  - [ ] `getOAuthCallbackPort()`
  - [ ] `validateOAuthCallbackConfig()`
  - [ ] `detectConfigTypos()`
- [ ] Update `AuthServer` in `src/auth/server.ts`
  - [ ] Constructor: port range configuration
  - [ ] OAuth2Client initialization with dynamic callback URL
  - [ ] Console output with remote host instructions
  - [ ] Port conflict detection and fail-fast
- [ ] Update `.env.example` with clear documentation
- [ ] Update `docs/docker.md` with prominent SSH tunneling recommendation
- [ ] Write unit tests for configuration helpers

**Phase 2: Testing & Validation**
- [ ] Unit tests for all helper functions
- [ ] Test invalid configurations (bad ports, typos)
- [ ] Manual test: local development (default behavior)
- [ ] Manual test: remote IP with firewall rules
- [ ] Manual test: SSH tunneling approach
- [ ] Update integration tests if needed

**Phase 3: Documentation**
- [ ] Update CLAUDE.md with remote deployment notes
- [ ] Add troubleshooting section to docs/docker.md
- [ ] Update README.md if remote deployment is a key feature
- [ ] Prepare release notes

**Phase 4: Future Enhancement (if users report issues)**
- [ ] Research device_name/device_id requirements
- [ ] Add environment variables if needed
- [ ] Document OAuth client type requirements

### 5. Testing Strategy

#### Unit Tests (`src/tests/unit/auth/oauth-callback-config.test.ts`)

```typescript
describe('OAuth Callback Configuration', () => {
  beforeEach(() => {
    // Clean environment
    delete process.env.OAUTH_CALLBACK_HOST;
    delete process.env.OAUTH_CALLBACK_PORT;
  });

  describe('getOAuthCallbackHost', () => {
    it('defaults to localhost', () => {
      expect(getOAuthCallbackHost()).toBe('localhost');
    });

    it('uses environment variable when set', () => {
      process.env.OAUTH_CALLBACK_HOST = '192.168.1.100';
      expect(getOAuthCallbackHost()).toBe('192.168.1.100');
    });
  });

  describe('getOAuthCallbackPort', () => {
    it('returns undefined by default', () => {
      expect(getOAuthCallbackPort()).toBeUndefined();
    });

    it('parses valid port from environment', () => {
      process.env.OAUTH_CALLBACK_PORT = '3500';
      expect(getOAuthCallbackPort()).toBe(3500);
    });

    it('throws error for invalid port', () => {
      process.env.OAUTH_CALLBACK_PORT = 'invalid';
      expect(() => getOAuthCallbackPort()).toThrow('Invalid OAUTH_CALLBACK_PORT');
    });

    it('throws error for out-of-range port', () => {
      process.env.OAUTH_CALLBACK_PORT = '99999';
      expect(() => getOAuthCallbackPort()).toThrow();
    });
  });

  describe('detectConfigTypos', () => {
    it('warns about common typos', () => {
      const spy = jest.spyOn(process.stderr, 'write').mockImplementation();
      process.env.OAUTH_CALLBAK_HOST = '192.168.1.100'; // Typo

      detectConfigTypos();

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('OAUTH_CALLBACK_HOST'));
      spy.mockRestore();
    });
  });

  describe('validateOAuthCallbackConfig', () => {
    it('shows setup instructions for remote hosts', () => {
      const spy = jest.spyOn(process.stderr, 'write').mockImplementation();
      process.env.OAUTH_CALLBACK_HOST = '192.168.1.100';

      validateOAuthCallbackConfig(3500);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('REMOTE HOST DETECTED'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('http://192.168.1.100:3500/oauth2callback'));
      spy.mockRestore();
    });

    it('does not show warnings for localhost', () => {
      const spy = jest.spyOn(process.stderr, 'write').mockImplementation();

      validateOAuthCallbackConfig(3500);

      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('REMOTE HOST DETECTED'));
      spy.mockRestore();
    });
  });
});
```

#### Manual Testing Checklist

**Test 1: Default Behavior (Backward Compatibility)**
```bash
# No environment variables set
npm run auth
# Expected: localhost:3500-3505, auto-detects available port
```

**Test 2: Remote IP with Firewall Rules**
```bash
# Set up remote configuration
export OAUTH_CALLBACK_HOST=192.168.1.100
export OAUTH_CALLBACK_PORT=3500

# Add redirect URI to Google Console first
npm run auth
# Expected: Shows setup instructions, auth works with remote IP
```

**Test 3: SSH Tunneling (Recommended)**
```bash
# Create SSH tunnel
ssh -L 3500:localhost:3500 user@remote-server

# No environment variables needed
npm run auth
# Expected: Works with localhost, traffic tunneled
```

**Test 4: Port Conflict**
```bash
# Occupy port 3500
nc -l 3500 &

export OAUTH_CALLBACK_PORT=3500
npm run auth
# Expected: Fails fast with helpful error message
```

**Test 5: Configuration Typos**
```bash
export OAUTH_CALLBAK_HOST=192.168.1.100  # Typo
npm run auth
# Expected: Warning about typo, suggests correct variable name
```

### 6. Backward Compatibility

✅ **Guaranteed Compatibility**:
- No environment variables = localhost:3500-3505 (unchanged)
- Existing Docker deployments work without modification
- Port auto-detection maintains existing behavior

✅ **Opt-in Only**:
- Remote host configuration requires explicit environment variables
- No automatic remote host detection that could break existing setups

### 7. User Experience Improvements

**Clear Logging**:
```
📋 OAuth Configuration:
   Host: 192.168.1.100 (OAUTH_CALLBACK_HOST)
   Port: 3500 (OAUTH_CALLBACK_PORT env var)

⚠️  REMOTE HOST DETECTED - SETUP REQUIRED:

   Before authenticating, add this redirect URI to Google Cloud Console:

   http://192.168.1.100:3500/oauth2callback

   Steps:
   1. Visit: https://console.cloud.google.com/apis/credentials
   2. Select your OAuth 2.0 Client ID
   3. Add the URI above to "Authorized redirect URIs"
   4. Save and return here to continue

   Alternative: Use SSH tunneling to avoid firewall configuration:
   - Run: ssh -L 3500:localhost:3500 user@192.168.1.100
   - Then use OAUTH_CALLBACK_HOST=localhost
```

**Fail-Fast on Errors**:
- Port unavailable → immediate error with suggestions
- Typos detected → warning with correct variable name
- Remote host → setup instructions before attempting auth

**SSH Tunneling Prominence**:
- Recommended as primary solution in docs
- Simpler (no firewall changes, no Google Console changes)
- More secure (encrypted tunnel)

### 8. Future Considerations

**device_name/device_id (if needed)**:
```bash
# Add these environment variables if testing reveals they're required
OAUTH_DEVICE_NAME="MyServer"
OAUTH_DEVICE_ID="server-123"
```

Implementation deferred to Phase 4 based on user feedback.

**OAuth Client Type Detection**:
Could detect OAuth client type from credentials file and warn if incompatible with remote deployment.

## Related Issues

- Issue #96: Make callback url changeable to allow configuration on remote host

## Decision Log

**Why SSH tunneling is recommended over direct IP**:
1. No firewall/NAT configuration needed
2. No Google Console redirect URI changes
3. Encrypted connection
4. Works with existing localhost-only OAuth credentials
5. Simpler user experience

**Why fail-fast on port conflicts**:
Previous behavior (trying ports 3500-3505) could mask configuration issues when user explicitly sets `OAUTH_CALLBACK_PORT`.

**Why verbose setup instructions**:
Google OAuth redirect URI whitelist is the #1 failure point. Proactive instructions prevent user confusion.
