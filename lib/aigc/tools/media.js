import tools from "./registry.js"
import fetch from "node-fetch"

function formatDate(d) {
  const pad = n => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

tools.register({
  name: "search",
  description: "综合搜索：网页(web)、图片(image)、音乐(music)、视频(video)。图片结果用 send_picture 发送；音乐/视频结果选一条后用 send_media 发送，不要直接展示文本。",
  parameters: {
    type: "object",
    properties: {
      q: { type: "string", description: "搜索关键词" },
      type: {
        type: "string",
        enum: ["web", "image", "music", "video"],
        description: "搜索类型",
      },
      limit: { type: "number", description: "返回数量，默认 10" },
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
        if (!res.ok) return `搜索后端返回 HTTP ${res.status}`
        const data = await res.json()

        if (type === "web") {
          const list = data.results || data.data?.results || data.data || []
          if (!list.length) return "未找到网页结果"
          const items = list.slice(0, limit).map((item, i) =>
            `${i + 1}. [${item.title}](${item.url})\n   摘要: ${item.snippet || item.description || ""}\n   来源: ${item.source || ""}`
          ).join("\n\n")
          return `<search_results>\n[${formatDate(new Date())}，请判定搜索结果时效性]\n${items}\n</search_results>`
        }

        if (type === "image") {
          const list = data.images || data.data?.images || []
          if (!list.length) return "未找到图片"
          const items = list.slice(0, limit).map((item, i) =>
            `${i + 1}. 标题: ${item.title}\n   URL: ${item.url}\n   Referer: ${item.source || ""}`
          ).join("\n\n")
          return `<image_results>\n${items}\n</image_results>`
        }
      } catch (err) {
        return `搜索失败: ${err.message}`
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
            `${i + 1}. 歌名: ${s.name}\n   id: ${s.id}\n   歌手: ${s.artists.map(a => a.name).join("&")}\n   别名: ${s.alias?.length ? s.alias.join(",") : "无"}`
          ).join("\n\n")
          return `<music_results>\n${items}\n</music_results>`
        }
        return `未找到音乐: ${q}`
      } catch (err) {
        return `音乐搜索失败: ${err.message}`
      }
    }

    // 视频搜索 (B站)
    if (type === "video") {
      try {
        const biliRes = await fetch("https://www.bilibili.com")
        const setCookie = biliRes.headers.raw()?.["set-cookie"]
        if (!setCookie) return "无法初始化视频搜索会话"

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
            const pubDate = r.pubdate ? formatDate(new Date(r.pubdate * 1000)) : "未知"
            return `${i + 1}. 标题: ${r.title.replace(/<em class="keyword">/g, "").replace(/<\/em>/g, "")}\n   id: ${r.bvid}\n   作者: ${r.author}\n   播放: ${r.play}\n   日期: ${pubDate}`
          }).join("\n\n")
          return `<video_results>\n${items}\n</video_results>`
        }
        return `未找到视频: ${q}`
      } catch (err) {
        return `视频搜索失败: ${err.message}`
      }
    }

    return `未知搜索类型: ${type}`
  },
})
