import fs from "node:fs"
import crypto from "node:crypto"
import cfg from "../config/config.js"
import fetch from "node-fetch"

class AigcError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.name = "AigcError"
  }
}

const MAX_VISION_IMAGES = 4

/* ---------- 图片下载 ---------- */

const IMG_DIR = "data/aigc/img"
const IMG_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp"]

function _imgCachePath(hash) {
  for (const ext of IMG_EXTS) {
    const p = `${IMG_DIR}/${hash}.${ext}`
    if (fs.existsSync(p)) return { path: p, mime: `image/${ext === "jpg" ? "jpeg" : ext}` }
  }
  return null
}

async function downloadImage(url) {
  // 本地缓存命中 → 直接读文件
  const hash = crypto.createHash("md5").update(url).digest("hex").slice(0, 12)
  const cached = _imgCachePath(hash)
  if (cached) {
    const buf = fs.readFileSync(cached.path)
    return { mimeType: cached.mime, data: buf.toString("base64") }
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 [${res.status}]`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const mime = res.headers.get("content-type") || "image/jpeg"
  const ext = mime.split("/")[1] || "jpg"

  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true })
  fs.writeFileSync(`${IMG_DIR}/${hash}.${ext}`, buffer)

  return { mimeType: mime, data: buffer.toString("base64") }
}

/* ---------- OpenAI ---------- */

async function buildOpenAIMessages(messages) {
  const maxImg = MAX_VISION_IMAGES
  const result = []
  for (const msg of messages) {
    const apiMsg = { role: msg.role }
    if (msg.tool_calls) apiMsg.tool_calls = msg.tool_calls
    if (msg.tool_call_id) apiMsg.tool_call_id = msg.tool_call_id
    if (msg.reasoning_content) apiMsg.reasoning_content = msg.reasoning_content

    // 文本内容
    let text = msg.content || ""

    // 图片 → 多模态 content 数组
    if (msg.role === "user" && msg.images?.length) {
      const parts = [{ type: "text", text }]
      const limit = Math.min(msg.images.length, maxImg)
      for (let i = 0; i < limit; i++) {
        try {
          const img = await downloadImage(msg.images[i])
          parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } })
        } catch (err) {
          logger.warn(`[aigc] image 下载失败  url=${msg.images[i].slice(0, 80)}  ${err.message}`)
        }
      }
      apiMsg.content = parts
    } else {
      apiMsg.content = text
    }

    result.push(apiMsg)
  }
  return result
}

function _collectKeys(config, options) {
  const raw = options.api_key || config.api_key || ""
  return raw.split(",").map(k => k.trim()).filter(Boolean)
}

let _keyIdx = 0

/** 轮询取 Key：每次请求从不同 Key 开始，失败顺延下一个，最多 3 次 */
function _rotateKeys(keys) {
  const max = Math.min(keys.length, 3)
  const start = _keyIdx % keys.length
  _keyIdx++
  const result = []
  for (let i = 0; i < max; i++) result.push(keys[(start + i) % keys.length])
  return result
}

async function openaiChat(messages, options = {}) {
  const config = cfg.aigc?.openai || {}
  const endpoint = options.endpoint || config.endpoint
  const model = options.model || config.model || "gpt-4o-mini"

  if (!endpoint) throw new AigcError("NO_ENDPOINT", "未配置 OpenAI endpoint")

  const keys = _collectKeys(config, options)
  if (!keys.length) throw new AigcError("NO_API_KEY", "未配置 OpenAI API Key")

  const apiMessages = await buildOpenAIMessages(messages)

  const body = {
    model,
    messages: apiMessages,
    max_tokens: options.max_tokens ?? config.max_tokens ?? 2048,
    temperature: options.temperature ?? config.temperature ?? 0.7,
  }

  if (options.tools?.length) body.tools = options.tools
  if (options.tool_choice) body.tool_choice = options.tool_choice

  const rotated = _rotateKeys(keys)
  let lastError

  for (let attempt = 0; attempt < rotated.length; attempt++) {
    const api_key = rotated[attempt]
    const t0 = Date.now()
    try {
      const res = await fetch(`${endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${api_key}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        throw new AigcError(res.status, `API 错误 [${res.status}]: ${text}`)
      }

      const data = await res.json()
      const choice = data.choices?.[0]
      const usage = data.usage

      if (usage) {
        logger.info(`[aigc] api  provider=openai  model=${model}  prompt=${usage.prompt_tokens}  completion=${usage.completion_tokens}  total=${usage.total_tokens}  ${Date.now() - t0}ms`)
      } else {
        logger.info(`[aigc] api  provider=openai  model=${model}  ${Date.now() - t0}ms`)
      }

      return {
        content: choice?.message?.content || "",
        tool_calls: choice?.message?.tool_calls,
        reasoning_content: choice?.message?.reasoning_content,
        usage,
      }
    } catch (err) {
      lastError = err
      if (attempt < rotated.length - 1) {
        logger.warn(`[aigc] retry  provider=openai  attempt=${attempt + 1}/${rotated.length}  err=${err.message}`)
      }
    }
  }

  throw lastError
}

/* ---------- Gemini ---------- */

const GEMINI_DEFAULT_SAFETY = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
]

async function geminiChat(messages, options = {}) {
  const config = cfg.aigc?.gemini || {}
  const endpoint = options.endpoint || config.endpoint || "https://generativelanguage.googleapis.com"
  const model = options.model || config.model || "gemini-2.0-flash"

  const keys = _collectKeys(config, options)
  if (!keys.length) throw new AigcError("NO_API_KEY", "未配置 Gemini API Key")

  const { contents, systemInstruction, tools } = await convertToGemini(messages, options.tools)

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: options.max_tokens ?? config.max_tokens ?? 2048,
      temperature: options.temperature ?? config.temperature ?? 0.7,
    },
    safetySettings: GEMINI_DEFAULT_SAFETY,
  }

  if (systemInstruction) body.systemInstruction = systemInstruction
  if (tools?.length) body.tools = tools

  const rotated = _rotateKeys(keys)
  let lastError

  for (let attempt = 0; attempt < rotated.length; attempt++) {
    const api_key = rotated[attempt]
    const t0 = Date.now()
    try {
      const res = await fetch(
        `${endpoint}/v1beta/models/${model}:generateContent?key=${api_key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: options.signal,
        },
      )

      if (!res.ok) {
        const text = await res.text()
        throw new AigcError(res.status, `API 错误 [${res.status}]: ${text}`)
      }

      const data = await res.json()
      const candidate = data.candidates?.[0]
      const usage = data.usageMetadata

      if (usage) {
        logger.info(`[aigc] api  provider=gemini  model=${model}  prompt=${usage.promptTokenCount}  completion=${usage.candidatesTokenCount}  total=${usage.totalTokenCount}  ${Date.now() - t0}ms`)
      } else {
        logger.info(`[aigc] api  provider=gemini  model=${model}  ${Date.now() - t0}ms`)
      }

      if (!candidate?.content) {
        if (candidate?.finishReason) {
          logger.warn(`[aigc] gemini blocked  finishReason=${candidate.finishReason}`)
        }
        return { content: "", tool_calls: undefined, usage: null, blocked: true, finishReason: candidate?.finishReason }
      }

      const parts = candidate.content.parts || []
      const textParts = parts.filter(p => p.text).map(p => p.text)
      const fcParts = parts.filter(p => p.functionCall)

      return {
        content: textParts.join("") || "",
        tool_calls: fcParts.length
          ? fcParts.map((fc, i) => ({
              id: `call_${Date.now()}_${i}`,
              type: "function",
              function: {
                name: fc.functionCall.name,
                arguments: JSON.stringify(fc.functionCall.args || {}),
              },
              ...(fc.thought_signature && { thought_signature: fc.thought_signature }),
            }))
          : undefined,
        usage: usage
          ? { prompt_tokens: usage.promptTokenCount, completion_tokens: usage.candidatesTokenCount, total_tokens: usage.totalTokenCount }
          : null,
      }
    } catch (err) {
      lastError = err
      if (attempt < rotated.length - 1) {
        logger.warn(`[aigc] retry  provider=gemini  attempt=${attempt + 1}/${rotated.length}  err=${err.message}`)
      }
    }
  }

  throw lastError
}

/** OpenAI 消息格式 → Gemini 原生格式 */
async function convertToGemini(messages, openaiTools) {
  const contents = []
  let systemInstruction = null
  let pendingTC = null
  const maxImg = MAX_VISION_IMAGES

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] }
      continue
    }

    if (msg.role === "user") {
      const parts = []
      if (msg.content) parts.push({ text: String(msg.content) })

      // 图片 → inlineData
      if (msg.images?.length) {
        const limit = Math.min(msg.images.length, maxImg)
        for (let i = 0; i < limit; i++) {
          try {
            const img = await downloadImage(msg.images[i])
            parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
          } catch (err) {
            logger.warn(`[aigc] image 下载失败  url=${msg.images[i].slice(0, 80)}  ${err.message}`)
          }
        }
      }

      contents.push({ role: "user", parts: parts.length ? parts : [{ text: "" }] })
      pendingTC = null
      continue
    }

    if (msg.role === "assistant") {
      const parts = []
      if (msg.content) parts.push({ text: msg.content })
      if (msg.tool_calls) {
        pendingTC = msg.tool_calls
        for (const tc of msg.tool_calls) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments) } catch { /* pass */ }
          const fcPart = { functionCall: { name: tc.function.name, args } }
          if (tc.thought_signature) fcPart.thought_signature = tc.thought_signature
          parts.push(fcPart)
        }
      } else {
        pendingTC = null
      }
      contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] })
      continue
    }

    if (msg.role === "tool") {
      let fnName = "unknown"
      if (pendingTC && msg.tool_call_id) {
        const match = pendingTC.find(tc => tc.id === msg.tool_call_id)
        if (match) fnName = match.function.name
      }
      contents.push({
        role: "tool",
        parts: [{ functionResponse: { name: fnName, response: { content: msg.content } } }],
      })
      continue
    }
  }

  let tools = null
  if (openaiTools?.length) {
    tools = [{
      functionDeclarations: openaiTools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }]
  }

  return { contents, systemInstruction, tools }
}

/* ---------- 统一入口 ---------- */

class AigcProvider {
  async chat(messages, options = {}) {
    const provider = options.provider || cfg.aigc?.provider || "openai"

    if (provider === "openai") return openaiChat(messages, options)
    if (provider === "gemini") return geminiChat(messages, options)

    throw new AigcError("UNKNOWN_PROVIDER", `未知的 AIGC Provider: ${provider}`)
  }
}

export { AigcError }
export default new AigcProvider()
