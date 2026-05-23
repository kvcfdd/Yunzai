import tools from "./registry.js"
import browser from "../../renderer/browser.js"

const TPL = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;padding:24px 32px;max-width:780px;margin:0 auto;line-height:1.7;color:#1f2937;font-size:15px}
  h1{font-size:1.5em;margin:1.2em 0 .5em;border-bottom:2px solid #e5e7eb;padding-bottom:.3em}
  h2{font-size:1.25em;margin:1em 0 .4em}h3{font-size:1.1em;margin:.8em 0 .3em}
  pre{background:#f3f4f6;padding:16px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;font-size:13px;line-height:1.5}
  code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:.9em}
  pre code{background:none;padding:0}
  table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:8px 12px;text-align:left}th{background:#f9fafb}
  blockquote{border-left:3px solid #d1d5db;margin:0 0 1em;padding:4px 16px;color:#6b7280}
  ul,ol{padding-left:24px}li{margin:4px 0}
  a{color:#2563eb}img{max-width:100%}p{margin:0 0 .8em}
  hr{border:none;border-top:1px solid #e5e7eb;margin:1.5em 0}
</style></head><body>__CONTENT__</body></html>`

/* 简易 Markdown → HTML */
function md2html(md) {
  let h = md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="language-${lang}">${code.trim()}</code></pre>`)
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>")
  h = h.replace(/^#### (.+)$/gm, "<h4>$1</h4>")
  h = h.replace(/^### (.+)$/gm, "<h3>$1</h3>")
  h = h.replace(/^## (.+)$/gm, "<h2>$1</h2>")
  h = h.replace(/^# (.+)$/gm, "<h1>$1</h1>")
  h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  h = h.replace(/\*(.+?)\*/g, "<i>$1</i>")
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  h = h.replace(/^---$/gm, "<hr>")
  h = h.replace(/^(\s*)[-*]\s+(.+)$/gm, "$1<li>$2</li>")
  h = h.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>\n$1\n</ul>")
  h = h.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>")
  h = h.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>")
  h = h.replace(/^(?!<[a-z/])(.+)$/gm, "<p>$1</p>")
  h = h.replace(/<p>\s*<\/p>/g, "")
  h = h.replace(/<\/p>\n<p>/g, "</p><p>")
  h = h.replace(/<p>(<[a-z][\s\S]*?)<\/p>/g, "$1")
  return h
}

tools.register({
  name: "render_html",
  description: "将 Markdown 或 HTML 内容渲染为图片发送给用户。用于展示表格、图表、格式化说明、代码高亮等场景。",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "要渲染的 Markdown 或 HTML 内容。默认按 Markdown 解析。",
      },
      width: {
        type: "integer",
        description: "图片宽度，默认 780",
      },
    },
    required: ["content"],
  },
  execute: async (args, ctx) => {
    const realEvent = ctx?.event
    if (!realEvent) return "无法获取用户上下文"

    let html = args.content
    if (!/^\s*</.test(html)) html = md2html(html)
    const fullHtml = TPL.split("__CONTENT__").join(html)

    browser.startTask()
    let context = null
    try {
      const chromium = await browser.getBrowser()
      context = await chromium.newContext({
        viewport: { width: args.width || 780, height: 600 },
      })
      const page = await context.newPage()
      await page.setContent(fullHtml, { waitUntil: "networkidle" })

      const body = page.locator("body")
      const box = await body.boundingBox()
      if (box) {
        await page.setViewportSize({
          width: Math.max(Math.ceil(box.width), 1),
          height: Math.max(Math.ceil(box.height), 1),
        })
      }

      const imgBuf = await page.screenshot({ type: "jpeg", quality: 90 })

      realEvent.reply(global.segment.image(imgBuf))
      return "[已直接回复图片]"
    } catch (err) {
      logger.error(`[aigc] render  err=${err.message}`)
      return `渲染失败: ${err.message}`
    } finally {
      if (context) await context.close().catch(() => {})
      browser.endTask()
    }
  },
})
