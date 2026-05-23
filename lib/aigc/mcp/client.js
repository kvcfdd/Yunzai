import fetch from "node-fetch"

const PROTOCOL_VERSION = "2024-11-05"

class McpClient {
  constructor(name, config) {
    this.name = name
    this.url = config.url
    this.apiKey = config.api_key || ""
  }

  async connect() {
    // initialize
    const init = await this._request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "Yunzai", version: "1.0.0" },
    })
    logger.info(`[aigc] mcp init  server=${this.name}  version=${init?.protocolVersion}`)

    // initialized 通知
    this._notify("notifications/initialized", {})

    // 拉取工具列表
    const { tools } = await this._request("tools/list", {})
    return tools || []
  }

  async callTool(name, args) {
    const res = await this._request("tools/call", { name, arguments: args })
    if (res.isError) throw new Error(res.content?.[0]?.text || "MCP tool error")
    return res.content?.[0]?.text || JSON.stringify(res.content)
  }

  async _request(method, params) {
    const headers = { "Content-Type": "application/json" }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`MCP ${res.status}: ${text.slice(0, 200)}`)
    }

    const data = await res.json()
    if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`)
    return data.result
  }

  async _notify(method, params) {
    const headers = { "Content-Type": "application/json" }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    try {
      await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      })
    } catch { /* notification 不关心结果 */ }
  }
}

export default McpClient
