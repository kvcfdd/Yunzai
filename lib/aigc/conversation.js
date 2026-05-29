import cfg from "../config/config.js"
import store from "./store.js"

const PREFIX = "conv"

/** 会话管理，LevelDB 持久化，按消息轮数自动裁剪 */
class ConversationManager {
  /** 生成会话键: conv:self_id:user_id:group_id */
  sessionKey(self_id, user_id, group_id = "") {
    return `${PREFIX}:${self_id}:${user_id}:${group_id || "private"}`
  }

  async _read(key) {
    const session = await store.get(key)
    return session || null
  }

  async _write(key, session) {
    this._trim(session)
    await store.set(key, session)
  }

  async addMessage(sessionKey, role, content, extra = {}) {
    let session = await this._read(sessionKey)
    if (!session) session = { messages: [], createdAt: Date.now() }

    const msg = { role, ...extra }
    if (content !== undefined) msg.content = content
    session.messages.push(msg)
    await this._write(sessionKey, session)
    return session
  }

  /** 批量追加消息，一次读写一次裁剪。用于整轮对话原子落盘 */
  async appendMessages(sessionKey, msgs) {
    if (!msgs.length) return
    let session = await this._read(sessionKey)
    if (!session) session = { messages: [], createdAt: Date.now() }
    for (const m of msgs) {
      const msg = { role: m.role }
      if (m.content !== undefined) msg.content = m.content
      for (const [k, v] of Object.entries(m)) {
        if (k !== "role" && k !== "content") msg[k] = v
      }
      session.messages.push(msg)
    }
    await this._write(sessionKey, session)
  }

  /** 设置/替换 system 消息 */
  async setSystem(sessionKey, prompt) {
    let session = await this._read(sessionKey)
    if (!session) session = { messages: [], createdAt: Date.now() }

    if (session.messages[0]?.role === "system") {
      session.messages[0].content = prompt
    } else {
      session.messages.unshift({ role: "system", content: prompt })
    }
    await this._write(sessionKey, session)
  }

  async getMessages(sessionKey) {
    const session = await this._read(sessionKey)
    if (!session) return []
    this._trim(session)
    return [...session.messages]
  }

  async clearSession(sessionKey) {
    await store.del(sessionKey)
  }

  async clearAll() {
    await store.delByPrefix(`${PREFIX}:`)
  }

  /** 按轮次裁剪：最近 10 轮保留完整交互，更早的轮次只保留 user → assistant 最终回复，硬上限兜底 */
  _trim(session) {
    const maxHistory = cfg.aigc?.max_history || 30
    const limit = maxHistory * 2

    const hasSystem = session.messages[0]?.role === "system"
    const systemMsg = hasSystem ? [session.messages[0]] : []
    let rest = hasSystem ? session.messages.slice(1) : session.messages.slice()

    // 拆分为轮次，每轮从 user 开始
    const rounds = []
    let current = []
    for (const msg of rest) {
      if (msg.role === "user" && current.length > 0) {
        rounds.push(current)
        current = []
      }
      current.push(msg)
    }
    if (current.length > 0) rounds.push(current)

    const keepFull = 10
    const fullStart = Math.max(0, rounds.length - keepFull)
    const processed = []

    for (let i = 0; i < rounds.length; i++) {
      if (i >= fullStart) {
        processed.push(...rounds[i])
      } else {
        for (const msg of rounds[i]) {
          if (msg.role === "user") {
            processed.push(msg)
          } else if (msg.role === "assistant" && msg.content && !msg.tool_calls) {
            processed.push({ role: "assistant", content: msg.content })
          }
        }
      }
    }

    if (processed.length > limit) {
      let drop = processed.length - limit
      while (drop < processed.length && processed[drop].role !== "user") drop++
      processed.splice(0, drop)
    }

    session.messages = [...systemMsg, ...processed]
  }
}

export default new ConversationManager()
