import store from "./store.js"
import { embed, cosineSimilarity } from "./embedding.js"

const PREFIX = "kb"
const SEARCH_THRESHOLD = 0.65
const SEARCH_TOP_K = 3

/** 知识库 — 文档向量化存储 + 语义检索 */
class KnowledgeBase {
  _docId() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  /** 添加文档：embed → 存入 LevelDB */
  async add(content) {
    const contentStr = String(content).trim()
    if (!contentStr || contentStr.length < 2) return { error: "内容太短" }

    let vec
    try {
      vec = await embed(contentStr)
    } catch (err) {
      logger.error(`[aigc] kb embed 失败: ${err.message}`)
      return { error: `向量化失败: ${err.message}` }
    }

    if (!vec.length) return { error: "未配置 Gemini API Key，知识库不可用" }

    const id = this._docId()
    await store.set(`${PREFIX}:${id}`, {
      content: contentStr,
      embedding: vec,
      createdAt: Date.now(),
    })

    logger.info(`[aigc] kb add  id=${id}  len=${contentStr.length}`)
    return { id, content: contentStr.slice(0, 60) + (contentStr.length > 60 ? "..." : "") }
  }

  /** 删除文档 */
  async remove(id) {
    const doc = await store.get(`${PREFIX}:${id}`)
    if (!doc) return { error: "文档不存在" }
    await store.del(`${PREFIX}:${id}`)
    logger.info(`[aigc] kb del  id=${id}`)
    return { id }
  }

  /** 列出所有文档摘要 */
  async list() {
    const keys = await store.keys(PREFIX)
    if (!keys.length) return []

    const docs = []
    for (const k of keys) {
      const doc = await store.get(k)
      if (doc) {
        docs.push({
          id: k.replace(`${PREFIX}:`, ""),
          content: doc.content.slice(0, 80) + (doc.content.length > 80 ? "..." : ""),
          createdAt: doc.createdAt,
        })
      }
    }
    docs.sort((a, b) => b.createdAt - a.createdAt)
    return docs
  }

  /** 清除全部文档 */
  async clear() {
    await store.delByPrefix(PREFIX)
    logger.info("[aigc] kb clear")
  }

  /** 语义检索 */
  async search(query, topK) {
    const k = topK || SEARCH_TOP_K

    let qVec
    try {
      qVec = await embed(query)
    } catch (err) {
      logger.error(`[aigc] kb search embed 失败: ${err.message}`)
      return []
    }

    if (!qVec.length) return []

    const keys = await store.keys(PREFIX)
    if (!keys.length) return []

    const scored = []
    for (const key of keys) {
      const doc = await store.get(key)
      if (!doc?.embedding?.length) continue
      const score = cosineSimilarity(qVec, doc.embedding)
      if (score >= SEARCH_THRESHOLD) {
        scored.push({ id: key.replace(`${PREFIX}:`, ""), content: doc.content, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }

  /** 检索并格式化为系统提示词上下文 */
  async toContext(query) {
    const results = await this.search(query)
    if (!results.length) return ""

    const lines = ["\n## 相关知识库内容"]
    for (const r of results) {
      lines.push(`- ${r.content}`)
    }
    logger.info(`[aigc] kb hit  top_k=${results.length}  scores=${results.map(r => r.score.toFixed(3)).join(",")}`)
    return lines.join("\n")
  }
}

export default new KnowledgeBase()
