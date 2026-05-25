import tools from "./registry.js"
import fetch from "node-fetch"
import { formatDate } from "../time.js"

tools.register({
  name: "search",
  description: "Search the web for: web results, images, music, or video. For detailed web page content use fetch_website; for sending images use send_picture; for music/video playback use send_media.",
  parameters: {
    type: "object",
    properties: {
      q: { type: "string", description: "Search keyword" },
      type: {
        type: "string",
        enum: ["web", "image", "music", "video"],
        description: "Search type",
      },
      limit: { type: "number", description: "Number of results. Default: 10" },
    },
    required: ["q", "type"],
  },
  execute: async (args) => {
    const { q, type, limit = 10 } = args

    // 网页 / 图片搜索
    if (type === "web" || type === "image") {
      try {
        const url = `http://localhost:8080/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`
        const res = await fetch(url)
        if (!res.ok) return `Search backend returned HTTP ${res.status}`
        const data = await res.json()

        if (type === "web") {
          const list = data.results || data.data?.results || data.data || []
          if (!list.length) return "No web results found"
          const items = list.slice(0, limit).map((item, i) =>
            `${i + 1}. [${item.title}](${item.url})\n   Summary: ${item.snippet || item.description || ""}\n   Source: ${item.source || ""}`
          ).join("\n\n")
          return `<search_results>\n[${formatDate(new Date())}, please judge the timeliness of search results]\n${items}\n</search_results>`
        }

        if (type === "image") {
          const list = data.images || data.data?.images || []
          if (!list.length) return "No images found"
          const items = list.slice(0, limit).map((item, i) =>
            `${i + 1}. Title: ${item.title}\n   URL: ${item.url}\n   Referer: ${item.source || ""}`
          ).join("\n\n")
          return `<image_results>\n${items}\n</image_results>`
        }
      } catch (err) {
        return `Search failed: ${err.message}`
      }
    }

    // 音乐搜索
    if (type === "music") {
      try {
        const res = await fetch(`http://music.163.com/api/search/get/web?s=${encodeURIComponent(q)}&type=1&offset=0&total=true&limit=${limit}`)
        const json = await res.json()
        if (json.result?.songCount > 0) {
          const songs = json.result.songs.slice(0, limit)
          const items = songs.map((s, i) =>
            `${i + 1}. Title: ${s.name}\n   ID: ${s.id}\n   Artist: ${s.artists.map(a => a.name).join("&")}\n   Alias: ${s.alias?.length ? s.alias.join(",") : "None"}`
          ).join("\n\n")
          return `<music_results>\n${items}\n</music_results>`
        }
        return `No music found for: ${q}`
      } catch (err) {
        return `Music search failed: ${err.message}`
      }
    }

    // 视频搜索 (B站)
    if (type === "video") {
      try {
        const biliRes = await fetch("https://www.bilibili.com")
        const setCookie = biliRes.headers.getSetCookie()
        if (!setCookie) return "Cannot initialize video search session"

        const cookies = setCookie.map(h => h.split(";")[0]).join("; ")
        const headers = {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9",
          Referer: "https://www.bilibili.com",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          cookie: cookies,
        }

        const resp = await fetch(`https://api.bilibili.com/x/web-interface/search/type?keyword=${encodeURIComponent(q)}&search_type=video`, { headers })
        const j = await resp.json()

        if (j.data?.numResults > 0) {
          const videos = j.data.result.slice(0, limit)
          const items = videos.map((r, i) => {
            const pubDate = r.pubdate ? formatDate(new Date(r.pubdate * 1000)) : "Unknown"
            return `${i + 1}. Title: ${r.title.replace(/<em class="keyword">/g, "").replace(/<\/em>/g, "")}\n   ID: ${r.bvid}\n   Author: ${r.author}\n   Plays: ${r.play}\n   Date: ${pubDate}`
          }).join("\n\n")
          return `<video_results>\n${items}\n</video_results>`
        }
        return `No video found for: ${q}`
      } catch (err) {
        return `Video search failed: ${err.message}`
      }
    }

    return `Unknown search type: ${type}`
  },
})
