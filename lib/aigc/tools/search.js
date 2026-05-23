import tools from "./registry.js"
import fetch from "node-fetch"

tools.register({
  name: "web_search",
  description: "搜索互联网信息，获取最新资讯、新闻、知识等",
  parameters: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "搜索关键词",
      },
      limit: {
        type: "integer",
        description: "返回结果数量，默认 5，最大 10",
        default: 5,
      },
    },
    required: ["q"],
  },
  execute: async args => {
    const q = encodeURIComponent(args.q)
    const limit = Math.min(args.limit || 5, 10)

    const res = await fetch(`http://localhost:8080/search?q=${q}&type=web&limit=${limit}`)
    if (!res.ok) return `搜索请求失败 [${res.status}]`

    const data = await res.json()
    const results = data.results || data.data?.results || data.data || data.items || data

    if (Array.isArray(results)) {
      const items = results.slice(0, limit).map((r, i) => {
        const title = r.title || r.name || ""
        const snippet = (r.snippet || r.description || r.summary || r.content || "").slice(0, 300)
        const url = r.url || r.link || r.href || ""
        const source = r.source ? ` *${r.source}*` : ""
        return `${i + 1}. **[${title}](${url})**  \n> ${snippet}${source}`
      }).join("\n\n")
      return `## 搜索结果: ${args.q}\n\n${items}`
    }

    return JSON.stringify(data).slice(0, 2000)
  },
})
