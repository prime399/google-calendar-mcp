web: node build/index.js --transport http --host 0.0.0.0 --port ${PORT:-3000}
# mcp: node build/index.js --transport stdio
# NOTE: mcp process type disabled to force Heroku Agents to use HTTP transport
# In Convex mode, tokens are injected to the web dyno's memory and cannot be
# shared with stdio processes. HTTP mode is required for multi-tenant operation.
