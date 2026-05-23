import cfg from "../config/config.js"
import store from "./store.js"

const PREFIX = "conv"

/** 会话管理，LevelDB 持久化，按消息轮数自动裁剪 */
class ConversationManager {
  get config() {
    return cfg.aigc?.conversation || {}
  }

  sessionKey(self_id, user_id, group_id = "") {
    return `${PREFIX}:${self_id}:${user_id}:${group_id || "private"}`
  }

  async _read(key) {
    const session = await store.get(key)
    if (!session) return null
    return session
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

  /** 按 max_history 轮数裁剪，保留 system 消息 */
  _trim(session) {
    const maxHistory = this.config.max_history || 30

    const systemMsg = session.messages[0]?.role === "system" ? [session.messages[0]] : []
    const rest = systemMsg.length ? session.messages.slice(1) : session.messages

    while (rest.length > maxHistory * 2) rest.shift()

    session.messages = [...systemMsg, ...rest]
  }
}

export default new ConversationManager()
