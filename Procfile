# web: Direct HTTP access to the MCP server for custom integrations (optional)
web: node build/index.js --transport http --host 0.0.0.0 --port ${PORT:-3000}

# google-calendar-mcp: MCP tool discovery process for Heroku Agents API
# This process type name enables automatic tool registration with /v1/mcp/servers
# Uses HTTP transport to support multi-tenant token injection (tokens stored in-memory)
mcp-google-calendar: node build/index.js --transport http --host 0.0.0.0 --port ${PORT:-3000}
