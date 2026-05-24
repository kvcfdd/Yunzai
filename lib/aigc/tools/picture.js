import tools from "./registry.js"
import common from "../../common/common.js"
import { getDownloadDispatcher } from "../proxy.js"
import fetch from "node-fetch"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { pipeline } from "node:stream/promises"

tools.register({
  name: "send_picture",
  description: "发送一张或多张图片。提供图片 URL 和可选的 Referer。最多一次发 10 张。",
  parameters: {
    type: "object",
    properties: {
      images: {
        type: "array",
        description: "图片列表",
        items: {
          type: "object",
          properties: {
            url: { type: "string", description: "图片 URL" },
            referer: { type: "string", description: "可选 Referer" },
          },
          required: ["url"],
        },
      },
    },
    required: ["images"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "无法获取上下文"

    const { images } = args
    if (!Array.isArray(images) || !images.length) return "未提供有效图片信息"

    const tempDir = path.join(process.cwd(), "data", "aigc", "images")
    await fsp.mkdir(tempDir, { recursive: true }).catch(() => {})

    const download = async (item) => {
      const { url, referer } = item
      if (!url) return null

      const urlObj = new URL(url)
      const isPixiv = urlObj.hostname === "i.pximg.net"

      const headers = isPixiv
        ? {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            "cache-control": "max-age=0",
            "if-modified-since": "Wed, 06 May 2026 18:15:23 GMT",
            priority: "u=0, i",
            "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "cross-site",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            Referer: "https://www.pixiv.net/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          }
        : {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          }

      if (!isPixiv && referer) {
        try {
          new URL(referer.startsWith("http") ? referer : `https://${referer}`)
          headers.Referer = referer
        } catch {}
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30000)
      try {
        const res = await fetch(url, { signal: controller.signal, headers, dispatcher: getDownloadDispatcher() })
        if (!res.ok) return null
        const filePath = path.join(tempDir, `img_${crypto.randomUUID()}.png`)
        await pipeline(res.body, fs.createWriteStream(filePath))
        return filePath
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    }

    const localPaths = (await Promise.all(images.slice(0, 10).map(download))).filter(Boolean)
    if (!localPaths.length) return "所有图片下载失败"

    try {
      if (localPaths.length === 1) {
        await e.reply(global.segment.image(localPaths[0]))
      } else {
        const msgs = localPaths.map(fp => global.segment.image(fp))
        await e.reply(await common.makeForwardMsg(e, msgs))
      }
      return `已发送 ${localPaths.length} 张图片`
    } catch (err) {
      return `发送图片失败: ${err.message}`
    }
  },
})
