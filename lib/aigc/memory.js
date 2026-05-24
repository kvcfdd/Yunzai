import store from "./store.js"

const PREFIX = "mem"

/** 用户长期记忆，LevelDB 持久化，仅通过 #清除记忆 删除 */
class MemoryManager {
  async set(user_id, key, value) {
    await store.set(`${PREFIX}:${user_id}:${key}`, String(value))
  }

  async get(user_id, key) {
    return store.get(`${PREFIX}:${user_id}:${key}`)
  }

  async del(user_id, key) {
    return store.del(`${PREFIX}:${user_id}:${key}`)
  }

  async getAll(user_id) {
    const prefix = `${PREFIX}:${user_id}:`
    const keys = await store.keys(prefix)
    if (!keys.length) return {}

    const result = {}
    for (const k of keys) {
      const key = k.replace(prefix, "")
      const val = await store.get(k)
      if (val !== null) result[key] = val
    }
    return result
  }

  async clear(user_id) {
    await store.delByPrefix(`${PREFIX}:${user_id}:`)
  }

  /** 将记忆序列化为系统提示词片段 */
  async toContext(user_id) {
    const mems = await this.getAll(user_id)
    if (!Object.keys(mems).length) return ""
    const lines = ["\n## User Memory"]
    for (const [k, v] of Object.entries(mems)) lines.push(`- ${k}: ${v}`)
    return lines.join("\n")
  }
}

export default new MemoryManager()
