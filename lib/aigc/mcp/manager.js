import cfg from "../../config/config.js"
import tools from "../tools/registry.js"
import McpClient from "./client.js"

const MAX_TOOL_NAME_LEN = 64
const NAME_PATTERN = /[^a-zA-Z0-9_-]/g

function sanitizeName(raw) {
  let cleaned = String(raw).replace(NAME_PATTERN, "_").replace(/^_+|_+$/g, "")
  if (!cleaned) cleaned = "x"
  if (cleaned.length <= MAX_TOOL_NAME_LEN) return cleaned

  let hash = 0
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0
  const suffix = "_" + Math.abs(hash).toString(36).slice(0, 6)
  return cleaned.slice(0, MAX_TOOL_NAME_LEN - suffix.length) + suffix
}

class McpManager {
  constructor() {
    this.clients = []
  }

  async init() {
    const servers = cfg.aigc?.mcp?.servers || []
    if (!servers.length) return

    await Promise.allSettled(servers.map(srv => this._connectOne(srv)))
  }

  async _connectOne(srv) {
    if (!srv.url) {
      logger.warn(`[aigc] mcp skip  server=${srv.name || "?"}  reason=no url`)
      return
    }

    const rawName = srv.name || srv.url
    const serverName = sanitizeName(rawName)

    try {
      const client = new McpClient(serverName, srv)
      const mcpTools = await client.connect()
      this.clients.push(client)

      const registered = []
      for (const t of mcpTools) {
        const toolName = sanitizeName(`mcp_${serverName}_${t.name}`)
        tools.register({
          name: toolName,
          description: t.description || "",
          parameters: t.inputSchema || { type: "object", properties: {} },
          execute: async args => client.callTool(t.name, args),
        })
        registered.push(toolName)
      }

      logger.mark(`[aigc] mcp connected  server=${serverName}  tools=${registered.join(",") || "none"}`)
    } catch (err) {
      logger.error(`[aigc] mcp failed  server=${serverName}  err=${err.message}`)
    }
  }
}

export default new McpManager()
