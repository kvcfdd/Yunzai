import cfg from "../config/config.js"
import fetch from "node-fetch"

/** Gemini Embedding — 复用 gemini 配置的 endpoint 和 api_key */
async function embed(text) {
  const gemini = cfg.aigc?.gemini || {}
  const endpoint = gemini.endpoint || "https://generativelanguage.googleapis.com"
  const api_key = gemini.api_key
  const model = "gemini-embedding-2"

  if (!api_key) return []

  const res = await fetch(`${endpoint}/v1beta/models/${model}:embedContent?key=${api_key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embedding API 错误 [${res.status}]: ${err}`)
  }

  const data = await res.json()
  return data.embedding?.values || []
}

/** 余弦相似度 */
function cosineSimilarity(a, b) {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom ? dot / denom : 0
}

export { embed, cosineSimilarity }
