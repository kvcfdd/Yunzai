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

  /** 按 max_history 轮数裁剪；裁剪点必须落在 user 边界，避免拆散 tool_calls/tool 配对 */
  _trim(session) {
    const maxHistory = cfg.aigc?.max_history || 30
    const limit = maxHistory * 2

    const hasSystem = session.messages[0]?.role === "system"
    const systemMsg = hasSystem ? [session.messages[0]] : []
    let rest = hasSystem ? session.messages.slice(1) : session.messages.slice()

    if (rest.length > limit) {
      let drop = rest.length - limit
      while (drop < rest.length && rest[drop].role !== "user") drop++
      rest = rest.slice(drop)
    }

    session.messages = [...systemMsg, ...rest]
  }
}

export default new ConversationManager()
