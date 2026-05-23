import cfg from "../../config/config.js"
import tools from "../tools/registry.js"
import McpClient from "./client.js"

class McpManager {
  async init() {
    const servers = cfg.aigc?.mcp?.servers || []
    if (!servers.length) return

    for (const srv of servers) {
      if (!srv.url) {
        logger.warn(`[aigc] mcp skip  server=${srv.name || "?"}  reason=no url`)
        continue
      }
      const name = srv.name || srv.url
      try {
        const client = new McpClient(name, srv)
        const mcpTools = await client.connect()

        for (const t of mcpTools) {
          const toolName = `mcp_${name}_${t.name}`
          tools.register({
            name: toolName,
            description: t.description || "",
            parameters: t.inputSchema || { type: "object", properties: {} },
            execute: async args => {
              return await client.callTool(t.name, args)
            },
          })
        }

        logger.mark(`[aigc] mcp connected  server=${name}  tools=${mcpTools.map(t => t.name).join(",") || "none"}`)
      } catch (err) {
        logger.error(`[aigc] mcp failed  server=${name}  err=${err.message}`)
      }
    }
  }
}

export default new McpManager()
