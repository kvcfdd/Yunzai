/** 默认协议版本：2025-06-18 是当前最广泛部署的版本。需最新 DRAFT 规范时在配置中设置 protocol_version */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18"
let _reqId = 0

/** MCP JSON-RPC 客户端：现代路径直接 tools/list，旧版服务器回退 initialize 握手 */
class McpClient {
  constructor(name, config, transport) {
    this.name = name
    this.transport = transport
    this.preferredVersion = config.protocol_version || DEFAULT_PROTOCOL_VERSION
    this.negotiatedVersion = null
    this.legacyMode = false
  }

  /** 连接：先尝试现代路径，失败则回退旧版握手 */
  async connect() {
    try {
      const result = await this._request("tools/list", {})
      return result?.tools || []
    } catch (err) {
      if (this._isLegacyError(err)) return this._connectLegacy()
      throw err
    }
  }

  async callTool(name, args) {
    const res = await this._request("tools/call", { name, arguments: args })
    const text = this._extractContent(res)
    if (res?.isError) throw new Error(text || "MCP tool error")
    return text
  }

  /** 构建 JSON-RPC 消息，现代模式在顶层附带 _meta 元数据 */
  _buildMessage(method, params = {}) {
    const id = ++_reqId
    const msg = { jsonrpc: "2.0", id, method, params }

    if (!this.legacyMode) {
      msg._meta = {
        "io.modelcontextprotocol/protocolVersion": this.negotiatedVersion || this.preferredVersion,
        "io.modelcontextprotocol/clientInfo": { name: "Yunzai", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      }
    }

    return msg
  }

  async _request(method, params) {
    const msg = this._buildMessage(method, params)
    let response
    try {
      response = await this.transport.send(msg)
    } catch (err) {
      throw new Error(`MCP 传输错误 [${this.name}]: ${err.message}`)
    }

    if (!response) return null

    if (response.error) {
      const code = response.error.code
      const message = response.error.message

      // 版本不匹配 → 选取兼容版本重试一次
      if (code === -32004) {
        const supported = response.error.data?.supported || []
        return this._negotiateVersion(supported, method, params)
      }

      throw new Error(`MCP 错误 [${code}]: ${message}`)
    }

    return response.result
  }

  /** 从服务端支持的版本列表中选取最佳版本 */
  async _negotiateVersion(supported, method, params) {
    const version = supported.find(v => v === this.preferredVersion)
      || supported.find(v => /^\d{4}-\d{2}-\d{2}$/.test(v))
      || supported[0]

    if (!version) throw new Error(`无兼容的 MCP 协议版本。客户端: ${this.preferredVersion}，服务端: ${supported.join(", ")}`)

    this.negotiatedVersion = version
    logger.debug(`MCP 协议版本协商: ${this.name} → ${version}`)
    return this._request(method, params)
  }

  /** 判断是否为旧版服务器（需要 initialize 握手） */
  _isLegacyError(err) {
    const msg = err.message || ""
    return msg.includes("400") || msg.includes("404") || msg.includes("405") || msg.includes("-32601")
  }

  /** 旧版回退：initialize → initialized → tools/list */
  async _connectLegacy() {
    logger.debug(`MCP 回退旧版握手: ${this.name}`)
    this.legacyMode = true

    const initMsg = {
      jsonrpc: "2.0",
      id: ++_reqId,
      method: "initialize",
      params: {
        protocolVersion: this.preferredVersion,
        capabilities: {},
        clientInfo: { name: "Yunzai", version: "1.0.0" },
      },
    }

    let response = await this.transport.send(initMsg)
    if (!response || response.error) {
      throw new Error(`MCP initialize 失败: ${response?.error?.message || "无响应"}`)
    }

    const result = response.result
    if (result?.protocolVersion) {
      this.negotiatedVersion = result.protocolVersion
    }

    // initialized 通知
    await this.transport.notify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    })

    // 获取工具列表
    const toolsMsg = {
      jsonrpc: "2.0",
      id: ++_reqId,
      method: "tools/list",
      params: {},
    }
    response = await this.transport.send(toolsMsg)
    if (response?.error) {
      throw new Error(`MCP tools/list 失败: ${response.error.message}`)
    }

    return response?.result?.tools || []
  }

  /** 将 content[] 规范化为单段文本；非 text 类型转为占位符避免污染对话 */
  _extractContent(res) {
    if (!res) return ""
    const content = Array.isArray(res.content) ? res.content : []
    const parts = []
    for (const c of content) {
      if (!c || typeof c !== "object") continue
      switch (c.type) {
        case "text":
          if (c.text) parts.push(c.text)
          break
        case "image":
          parts.push(`[image ${c.mimeType || "?"}]`)
          break
        case "audio":
          parts.push(`[audio ${c.mimeType || "?"}]`)
          break
        case "resource_link":
          parts.push(`[resource_link ${c.uri || ""}]`)
          break
        case "resource": {
          const r = c.resource || {}
          parts.push(r.text || `[resource ${r.uri || ""}]`)
          break
        }
        default:
          break
      }
    }
    if (parts.length) return parts.join("\n")
    if (res.structuredContent) return JSON.stringify(res.structuredContent)
    return ""
  }

  async close() {
    await this.transport.close()
    this.negotiatedVersion = null
    this.legacyMode = false
  }
}

export default McpClient
