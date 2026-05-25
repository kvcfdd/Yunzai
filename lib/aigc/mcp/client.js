import fetch from "node-fetch"

const DEFAULT_PROTOCOL_VERSION = "2025-06-18"
const REQUEST_TIMEOUT_MS = 30_000
let _reqId = 0

class McpClient {
  constructor(name, config) {
    this.name = name
    this.url = config.url
    this.apiKey = config.api_key || ""
    this.protocolVersion = config.protocol_version || DEFAULT_PROTOCOL_VERSION
    this.timeout = config.timeout_ms || REQUEST_TIMEOUT_MS
    this.sessionId = null
    this.initialized = false
  }

  async connect() {
    await this._initialize()
    const { tools } = await this._request("tools/list", {})
    return tools || []
  }

  async _initialize() {
    this.sessionId = null
    this.initialized = false

    const result = await this._request("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "Yunzai", version: "1.0.0" },
    }, { isInitialize: true })

    if (result?.protocolVersion) {
      this.protocolVersion = result.protocolVersion
    }
    logger.info(`MCP 初始化  ${this.name}`)

    this.initialized = true
    await this._notify("notifications/initialized", {})
  }

  async callTool(name, args) {
    const res = await this._request("tools/call", { name, arguments: args })
    const text = this._extractContent(res)
    if (res.isError) throw new Error(text || "MCP tool error")
    return text
  }

  /** 把 content[] 数组规范化为单段文本，非 text 类型转占位符避免污染对话 */
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
          if (r.text) parts.push(r.text)
          else parts.push(`[resource ${r.uri || ""}]`)
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

  async _request(method, params, { isInitialize = false, retried = false } = {}) {
    const id = ++_reqId
    const body = { jsonrpc: "2.0", id, method, params }
    const res = await this._fetch(body, { isInitialize })

    if (res.status === 404 && this.sessionId && !isInitialize && !retried) {
      logger.warn(`MCP 会话过期  ${this.name}`)
      await this._initialize()
      return this._request(method, params, { isInitialize, retried: true })
    }

    if (!res.ok) {
      const text = await this._readErrorBody(res)
      throw new Error(`MCP ${res.status}: ${text.slice(0, 200)}`)
    }

    if (isInitialize) {
      const sid = res.headers.get("mcp-session-id")
      if (sid) this.sessionId = sid
    }

    const data = await this._readJsonRpc(res, id)
    if (data?.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`)
    return data?.result
  }

  async _notify(method, params) {
    try {
      const res = await this._fetch({ jsonrpc: "2.0", method, params }, { isNotification: true })
      if (!res.ok && res.status !== 202) {
        logger.warn(`MCP 通知异常  ${this.name}  ${method}  ${res.status}`)
      }
    } catch (err) {
      logger.warn(`MCP 通知异常  ${this.name}  ${method}: ${err.message}`)
    }
  }

  async _fetch(body, { isInitialize = false, isNotification = false } = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId
    if (!isInitialize) headers["MCP-Protocol-Version"] = this.protocolVersion

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)
    try {
      return await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async _readErrorBody(res) {
    try { return await res.text() } catch { return "" }
  }

  /** 解析响应：可能是 application/json 或 text/event-stream（SSE） */
  async _readJsonRpc(res, expectId) {
    const ctype = (res.headers.get("content-type") || "").toLowerCase()
    if (ctype.includes("text/event-stream")) {
      return await this._readSseResponse(res, expectId)
    }
    if (res.status === 202) return null
    const text = await res.text()
    if (!text) return null
    return JSON.parse(text)
  }

  /** SSE 流：寻找 id 匹配的 JSON-RPC response 后立即返回 */
  async _readSseResponse(res, expectId) {
    const decoder = new TextDecoder()
    let buf = ""
    let dataBuf = ""

    const handleEvent = () => {
      if (!dataBuf) return null
      const payload = dataBuf
      dataBuf = ""
      try {
        const msg = JSON.parse(payload)
        if (msg && msg.jsonrpc === "2.0" && msg.id === expectId) return msg
      } catch { /* 忽略非 JSON-RPC 事件 */ }
      return null
    }

    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true })
      let idx
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, "")
        buf = buf.slice(idx + 1)
        if (line === "") {
          const matched = handleEvent()
          if (matched) return matched
        } else if (line.startsWith("data:")) {
          dataBuf += (dataBuf ? "\n" : "") + line.slice(5).trimStart()
        }
        // 其它字段
      }
    }
    const matched = handleEvent()
    if (matched) return matched
    throw new Error("SSE stream ended without matching JSON-RPC response")
  }

  /** 主动关闭会话 */
  async close() {
    if (!this.sessionId) return
    const headers = {
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": this.protocolVersion,
      "Mcp-Session-Id": this.sessionId,
    }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    try {
      await fetch(this.url, { method: "DELETE", headers })
    } catch { /* 关闭尽力而为 */ }
    this.sessionId = null
    this.initialized = false
  }
}

export default McpClient
