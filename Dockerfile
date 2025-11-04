# Google Calendar MCP Server - Optimized Dockerfile
# syntax=docker/dockerfile:1
#
# Supports both local and Heroku deployment
# For Heroku: Set CONVEX_MODE=true, TRANSPORT=http
# Heroku automatically sets PORT environment variable

FROM node:18-alpine

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

# Set working directory
WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./

# Copy build scripts and source files needed for build
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json .

# Install all dependencies (including dev dependencies for build)
RUN npm ci --no-audit --no-fund --silent

# Build the project
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production --silent

# Create config directory and set permissions
# Note: In Convex mode, tokens are managed in memory, not stored on disk
RUN mkdir -p /home/nodejs/.config/google-calendar-mcp && \
    chown -R nodejs:nodejs /home/nodejs/.config && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port for HTTP mode
# Heroku will dynamically assign PORT at runtime
EXPOSE ${PORT:-3000}

# Environment defaults (can be overridden at runtime)
ENV TRANSPORT=http
ENV HOST=0.0.0.0
ENV NODE_ENV=production

# Default command - run with HTTP transport
# For Heroku, PORT is automatically set by the platform
CMD ["node", "build/index.js", "--transport", "http", "--host", "0.0.0.0"]