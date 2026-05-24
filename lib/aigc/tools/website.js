import tools from "./registry.js"
import browser from "../../renderer/browser.js"
import { getPlaywrightProxy } from "../proxy.js"
import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import dns from "node:dns/promises"
import net from "node:net"

const MAX_CONTENT_LENGTH = 30000

/** 是否为内网 / loopback / link-local / 多播 / 保留地址 */
function isPrivateIp(ip) {
  if (!ip) return true
  const v = net.isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number)
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (v === 6) {
    const lower = ip.toLowerCase()
    if (lower === "::1" || lower === "::") return true
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true
    if (lower.startsWith("ff")) return true
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7))
    return false
  }
  return true
}

async function isHostnameSafe(hostname) {
  if (!hostname) return false
  const lower = hostname.toLowerCase()
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal")) {
    return false
  }
  if (net.isIP(lower)) return !isPrivateIp(lower)
  try {
    const records = await dns.lookup(lower, { all: true })
    for (const r of records) {
      if (isPrivateIp(r.address)) return false
    }
    return true
  } catch {
    return false
  }
}

tools.register({
  name: "fetch_website",
  description: "Fetch a web page, extract main content and convert to Markdown. Use for getting detailed web page content to assist answers. Use the useProxy parameter to control whether to use the local proxy.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Web page URL to fetch",
      },
      useProxy: {
        type: "boolean",
        description: "Whether to use local proxy. Default: false. Some sites require a proxy to access",
      },
    },
    required: ["url"],
  },
  execute: async (args) => {
    const { url, useProxy = false } = args
    const urlRegex = /^https?:\/\/[^\s]+$/i
    if (!urlRegex.test(url)) return "Invalid URL format"

    let parsed
    try { parsed = new URL(url) } catch { return "Invalid URL format" }
    if (!(await isHostnameSafe(parsed.hostname))) {
      logger.warn(`[aigc] fetch_website ssrf-block  host=${parsed.hostname}`)
      return "Access to internal/private network addresses denied"
    }

    let browserContext, page, doc
    browser.startTask()
    try {
      const brow = await browser.getBrowser()
      if (!brow) return "Browser initialization failed"

      const contextOpts = {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "zh-CN",
        ignoreHTTPSErrors: true,
      }
      const proxy = getPlaywrightProxy(useProxy)
      if (proxy) contextOpts.proxy = proxy

      browserContext = await brow.newContext(contextOpts)

      page = await browserContext.newPage()

      // 拦截媒体请求减少带宽
      await page.route("**/*", (route) => {
        const type = route.request().resourceType()
        if (["image", "media", "font", "stylesheet"].includes(type)) {
          route.abort()
        } else {
          route.continue()
        }
      })

      const response = await page.goto(url, { waitUntil: "load", timeout: 30000 })
      if (!response || response.status() >= 400) {
        return `Fetch failed: HTTP ${response?.status() || "unknown"}`
      }

      await page.waitForTimeout(1500)

      // 清理 DOM：移除脚本、样式、空链接，图片替换为 alt 文本
      await page.evaluate(() => {
        document.querySelectorAll("script, style, noscript, iframe, svg, canvas, video, audio").forEach(el => el.remove())
        document.querySelectorAll("img, picture").forEach(img => {
          if (img.alt?.trim()) {
            img.parentNode.replaceChild(document.createTextNode(` [img:${img.alt}] `), img)
          } else {
            img.remove()
          }
        })
        document.querySelectorAll("a").forEach(a => {
          if (!a.innerText.trim()) a.remove()
        })
      })

      const html = await page.content()
      doc = new JSDOM(html, { url })

      const reader = new Readability(doc.window.document)
      const article = reader.parse()

      const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
      turndown.remove(["head", "footer", "nav", "aside", "form", "button"])

      let finalContent = ""
      let pageTitle = ""

      if (article?.content) {
        pageTitle = article.title || "Untitled"
        finalContent = turndown.turndown(article.content)
      } else {
        pageTitle = doc.window.document.title || "Untitled"
        finalContent = turndown.turndown(doc.window.document.body.innerHTML)
      }

      finalContent = finalContent
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\[\s*\]/g, "")
        .trim()

      if (finalContent.length > MAX_CONTENT_LENGTH) {
        finalContent = finalContent.slice(0, MAX_CONTENT_LENGTH) + "\n\n...[Content truncated]"
      }

      if (!finalContent) return "Extracted content is empty"

      logger.mark(`[aigc] fetch_website  url=${url}  title=${pageTitle}  len=${finalContent.length}`)

      return `<web_content>\nTitle: ${pageTitle}\nSource: ${url}\n\n${finalContent}\n</web_content>`
    } catch (err) {
      let msg = err.message || "Unknown error"
      if (msg.includes("Timeout")) msg = "Navigation timeout"
      logger.error(`[aigc] fetch_website  err=${msg}`)
      return `Web fetch failed: ${msg}`
    } finally {
      if (doc?.window) doc.window.close()
      if (browserContext) await browserContext.close().catch(() => { })
      browser.endTask()
    }
  },
})
