# Convex Integration Guide

This guide explains how to integrate the Google Calendar MCP Server with study-flow's Convex-based authentication system for deployment on Heroku as an external MCP server.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Deployment to Heroku](#deployment-to-heroku)
- [Study-Flow Integration](#study-flow-integration)
- [API Reference](#api-reference)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Overview

The Convex integration mode allows the Google Calendar MCP Server to work with study-flow's existing Convex-based authentication system. Instead of storing OAuth tokens in files, tokens are:

1. Stored in study-flow's Convex database
2. Injected into the MCP server via API when needed
3. Managed in-memory for multiple users simultaneously

This enables:
- **Multi-tenancy**: One MCP server deployment serves multiple users
- **Centralized auth**: Single source of truth for OAuth tokens in Convex
- **Heroku deployment**: Stateless, scalable deployment on Heroku

## Architecture

### Token Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Study-Flow (Next.js)                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 1. User Request → AI Helper API                         │    │
│  │                                                          │    │
│  │ 2. Fetch User Tokens from Convex                       │    │
│  │    - Query googleCalendarTokens table                   │    │
│  │    - Decrypt tokens (base64)                           │    │
│  │    - Check expiry, refresh if needed                   │    │
│  │                                                          │    │
│  │ 3. Inject Tokens to MCP Server                         │    │
│  │    POST https://mcp-server.herokuapp.com/api/tokens     │    │
│  │    Headers: X-API-Key: <MCP_API_KEY>                   │    │
│  │    Body: { userId, accessToken, refreshToken, ...}     │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              Google Calendar MCP Server (Heroku)                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 4. Store Tokens in Memory                               │    │
│  │    ConvexTokenProvider.setUserTokens(userId, tokens)   │    │
│  │                                                          │    │
│  │ 5. AI Agent Invokes Tools via Heroku Agents API       │    │
│  │    Tool: list-calendars, create-event, etc.            │    │
│  │    Args: { userId, ...other params }                   │    │
│  │                                                          │    │
│  │ 6. Tool Handler Execution                              │    │
│  │    - Extract userId from request                       │    │
│  │    - Get user-specific OAuth2Client                    │    │
│  │    - Execute Google Calendar API call                  │    │
│  │    - Return results                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Google Calendar API                           │
│           Authenticated with user-specific tokens                │
└─────────────────────────────────────────────────────────────────┘
```

### Components

**Study-Flow Components:**
- `convex/googleCalendar.ts`: Token storage and retrieval from Convex
- `lib/mcp-token-injector.ts`: Token injection service (NEW)
- `app/api/calendar-tools/route.ts`: Calendar tool proxy (MODIFIED)
- `app/api/ai-helper/route.ts`: AI helper with MCP integration (MODIFIED)

**MCP Server Components:**
- `src/auth/convexTokenProvider.ts`: Multi-tenant token management (NEW)
- `src/config/ConvexConfig.ts`: Convex mode configuration (NEW)
- `src/api/tokenEndpoints.ts`: Token injection API (NEW)
- `src/api/managementEndpoints.ts`: Health checks and metrics (NEW)
- `src/middleware/auth.ts`: Authentication and security (NEW)
- `src/server.ts`: Server with Convex mode support (MODIFIED)

## Prerequisites

### Google Cloud Setup

1. Create a Google Cloud Project
2. Enable Google Calendar API
3. Create OAuth 2.0 credentials (Web application type)
4. Add authorized redirect URIs (not used in Convex mode, but required by Google)
5. Note your Client ID and Client Secret

### Heroku Setup

1. Heroku account with CLI installed
2. Container Registry enabled:
   ```bash
   heroku container:login
   ```

### Study-Flow Setup

1. Convex project with authentication configured
2. Google Calendar OAuth tokens stored in Convex
3. Schema includes `googleCalendarTokens` table

## Deployment to Heroku

### Step 1: Prepare the Repository

```bash
cd /workspaces/study-flow/google-calendar-mcp
```

### Step 2: Create Heroku App

```bash
# Create a new Heroku app
heroku create your-calendar-mcp-server

# Set the stack to container
heroku stack:set container -a your-calendar-mcp-server
```

### Step 3: Configure Environment Variables

Generate a secure API key (min 32 characters):
```bash
# Generate API key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set all required environment variables:
```bash
# Convex mode
heroku config:set CONVEX_MODE=true -a your-calendar-mcp-server

# API Key for authentication
heroku config:set MCP_API_KEY="your-generated-api-key" -a your-calendar-mcp-server

# Google OAuth credentials
heroku config:set GOOGLE_CLIENT_ID="your-client-id" -a your-calendar-mcp-server
heroku config:set GOOGLE_CLIENT_SECRET="your-client-secret" -a your-calendar-mcp-server

# CORS configuration (study-flow URL)
heroku config:set ALLOWED_ORIGINS="https://your-study-flow-app.vercel.app,https://your-study-flow-app.com" -a your-calendar-mcp-server

# Optional: Rate limiting configuration
heroku config:set RATE_LIMIT_REQUESTS_PER_USER=100 -a your-calendar-mcp-server
heroku config:set RATE_LIMIT_TOKEN_INJECTIONS_PER_IP=10 -a your-calendar-mcp-server
```

### Step 4: Deploy to Heroku

```bash
# Build and push the Docker image
heroku container:push web -a your-calendar-mcp-server

# Release the container
heroku container:release web -a your-calendar-mcp-server
```

### Step 5: Verify Deployment

```bash
# Check logs
heroku logs --tail -a your-calendar-mcp-server

# Test health endpoint
curl https://your-calendar-mcp-server.herokuapp.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "server": "google-calendar-mcp",
  "mode": "convex",
  "timestamp": "2025-11-04T...",
  "uptime": 123.45,
  "users": {
    "total": 0,
    "active": 0
  }
}
```

## Study-Flow Integration

### Environment Variables

Add to study-flow's `.env.local`:
```bash
GOOGLE_CALENDAR_MCP_URL=https://your-calendar-mcp-server.herokuapp.com
GOOGLE_CALENDAR_MCP_API_KEY=your-generated-api-key
```

### Token Injection Service

Create `lib/mcp-token-injector.ts`:
```typescript
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function injectUserTokens(userId: string): Promise<void> {
  // Fetch tokens from Convex
  const tokens = await convex.query(api.googleCalendar.getTokens, {});

  if (!tokens) {
    throw new Error('No tokens found for user');
  }

  // Decrypt tokens (base64)
  const accessToken = Buffer.from(tokens.accessToken, 'base64').toString('utf-8');
  const refreshToken = Buffer.from(tokens.refreshToken, 'base64').toString('utf-8');

  // Inject to MCP server
  const response = await fetch(`${process.env.GOOGLE_CALENDAR_MCP_URL}/api/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.GOOGLE_CALENDAR_MCP_API_KEY!,
    },
    body: JSON.stringify({
      userId,
      accessToken,
      refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      tokenType: tokens.tokenType || 'Bearer',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to inject tokens: ${response.statusText}`);
  }
}
```

### AI Helper Integration

Modify `app/api/ai-helper/route.ts` to inject tokens before AI requests:
```typescript
// Before making AI request
await injectUserTokens(userId);

// Include userId in tool arguments when calling Heroku Agents API
const tools = mcpTools.map(tool => ({
  ...tool,
  // Ensure userId is included in tool invocations
}));
```

## API Reference

### Token Management Endpoints

#### POST /api/tokens

Inject or update user tokens.

**Request:**
```http
POST /api/tokens HTTP/1.1
Host: your-calendar-mcp-server.herokuapp.com
Content-Type: application/json
X-API-Key: your-api-key

{
  "userId": "user_123",
  "accessToken": "ya29.a0...",
  "refreshToken": "1//0g...",
  "expiresAt": 1699123456789,
  "scope": "https://www.googleapis.com/auth/calendar",
  "tokenType": "Bearer"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Tokens injected successfully",
  "userId": "user_123",
  "expiresAt": 1699123456789,
  "expiresIn": 3600000,
  "timestamp": "2025-11-04T..."
}
```

**Error Responses:**
- `400`: Invalid request body or token validation failed
- `401`: Invalid or missing API key
- `429`: Rate limit exceeded

#### GET /api/tokens/:userId/status

Check token status for a user.

**Request:**
```http
GET /api/tokens/user_123/status HTTP/1.1
Host: your-calendar-mcp-server.herokuapp.com
X-API-Key: your-api-key
```

**Response:**
```json
{
  "userId": "user_123",
  "hasTokens": true,
  "valid": true,
  "expiresAt": 1699123456789,
  "expiresIn": 3600000,
  "expired": false,
  "scope": "https://www.googleapis.com/auth/calendar",
  "timestamp": "2025-11-04T..."
}
```

#### DELETE /api/tokens/:userId

Remove user tokens (logout).

**Request:**
```http
DELETE /api/tokens/user_123 HTTP/1.1
Host: your-calendar-mcp-server.herokuapp.com
X-API-Key: your-api-key
```

**Response:**
```json
{
  "success": true,
  "userId": "user_123",
  "message": "Tokens removed successfully",
  "timestamp": "2025-11-04T..."
}
```

### Management Endpoints

#### GET /health

Health check endpoint (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "server": "google-calendar-mcp",
  "mode": "convex",
  "timestamp": "2025-11-04T...",
  "uptime": 123.45,
  "memory": {
    "used": 12345678,
    "total": 23456789
  },
  "users": {
    "total": 5,
    "active": 3
  }
}
```

#### GET /metrics

Detailed metrics (no authentication required).

**Response:**
```json
{
  "server": {
    "name": "google-calendar-mcp",
    "mode": "convex",
    "uptime": 123.45,
    "nodeVersion": "v18.x.x",
    "platform": "linux"
  },
  "tokens": {
    "totalUsers": 5,
    "activeUsers": 3,
    "expiredTokens": 1,
    "oldestTokenAge": 86400000,
    "newestTokenAge": 3600000
  },
  "memory": { ... },
  "process": { ... },
  "config": { ... }
}
```

#### GET /api/users/active

List active users (requires API key).

**Response:**
```json
{
  "total": 5,
  "active": 3,
  "expired": 1,
  "users": [
    {
      "userId": "user_123",
      "valid": true,
      "expiresIn": 3600000,
      "scope": "https://www.googleapis.com/auth/calendar"
    }
  ]
}
```

### Calendar Tool Usage

When invoking calendar tools via the MCP protocol, include `userId` in the arguments:

**Example:**
```json
{
  "tool": "list-events",
  "arguments": {
    "userId": "user_123",
    "calendarId": "primary",
    "timeMin": "2025-11-04T00:00:00Z",
    "timeMax": "2025-11-05T00:00:00Z"
  }
}
```

## Security Considerations

### API Key Management

- Generate a strong API key (min 32 characters)
- Store securely in Heroku config vars and study-flow environment
- Rotate periodically
- Never commit to version control

### CORS Configuration

- Set `ALLOWED_ORIGINS` to specific study-flow domains
- Avoid using wildcard (`*`) in production
- Include all necessary origins (production, staging, etc.)

### Rate Limiting

Default rate limits:
- **Per user**: 100 requests per 15 minutes
- **Token injections per IP**: 10 per 15 minutes

Adjust based on your usage:
```bash
heroku config:set RATE_LIMIT_REQUESTS_PER_USER=200 -a your-app
heroku config:set RATE_LIMIT_WINDOW_MS=900000 -a your-app
```

### Token Security

- Tokens stored in memory only (no disk persistence)
- Automatic cleanup after 24 hours of inactivity
- User isolation enforced at application level
- No logging of sensitive token data

### HTTPS

- Heroku enforces HTTPS by default
- All token transmission encrypted in transit
- No HTTP fallback

## Troubleshooting

### Common Issues

#### 1. "Invalid or missing API key"

**Cause**: API key mismatch between study-flow and MCP server

**Solution**:
```bash
# Check MCP server config
heroku config:get MCP_API_KEY -a your-app

# Verify it matches study-flow environment variable
```

#### 2. "No valid tokens found for user"

**Cause**: Tokens not injected or expired

**Solution**:
- Ensure `injectUserTokens()` is called before tool invocation
- Check token expiry in Convex
- Verify token injection response was successful

#### 3. "Origin not allowed"

**Cause**: CORS configuration mismatch

**Solution**:
```bash
# Add study-flow domain to allowed origins
heroku config:set ALLOWED_ORIGINS="https://your-domain.com" -a your-app
```

#### 4. "Rate limit exceeded"

**Cause**: Too many requests from user or IP

**Solution**:
- Wait for rate limit window to reset
- Increase rate limits if legitimate usage:
  ```bash
  heroku config:set RATE_LIMIT_REQUESTS_PER_USER=200 -a your-app
  ```

### Debugging

#### Check Logs

```bash
# Real-time logs
heroku logs --tail -a your-app

# Search for errors
heroku logs -a your-app | grep ERROR
```

#### Test Token Injection

```bash
curl -X POST https://your-app.herokuapp.com/api/tokens \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "userId": "test_user",
    "accessToken": "ya29.test",
    "refreshToken": "1//test",
    "expiresAt": 9999999999999,
    "scope": "https://www.googleapis.com/auth/calendar",
    "tokenType": "Bearer"
  }'
```

#### Check Token Status

```bash
curl https://your-app.herokuapp.com/api/tokens/test_user/status \
  -H "X-API-Key: your-api-key"
```

#### Monitor Metrics

```bash
curl https://your-app.herokuapp.com/metrics
```

### Getting Help

If you encounter issues:

1. Check Heroku logs for errors
2. Verify all environment variables are set correctly
3. Test API endpoints directly with curl
4. Check GitHub issues: https://github.com/nspady/google-calendar-mcp/issues
5. Review security and rate limiting settings

## Next Steps

After deployment:

1. **Test Integration**: Verify token injection and tool invocations work end-to-end
2. **Monitor Performance**: Use `/metrics` endpoint to track usage
3. **Set Up Alerts**: Configure Heroku alerts for app downtime
4. **Scale as Needed**: Adjust dyno size based on usage patterns
5. **Regular Maintenance**: Monitor logs, update dependencies, rotate API keys

## Additional Resources

- [Heroku Container Deployment](https://devcenter.heroku.com/articles/container-registry-and-runtime)
- [Google Calendar API Documentation](https://developers.google.com/calendar/api/guides/overview)
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [Convex Documentation](https://docs.convex.dev)
