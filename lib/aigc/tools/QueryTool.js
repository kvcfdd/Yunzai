import tools from "./registry.js"
import cfg from "../../config/config.js"
import log from "../helpers/log.js"

const API = "https://uapis.cn/api/v1/social/qq/userinfo"

async function fetchQQInfo(qq) {
  try {
    const res = await fetch(`${API}?qq=${qq}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function formatUser(data, isOwner) {
  const parts = [isOwner ? "这是你的 master（Bot 管理员）" : "这是查询到的用户"]
  parts.push(`昵称: ${data.nickname || "Unknown"}`)
  if (data.sex) parts.push(data.sex === "男" ? "性别: 男" : data.sex === "女" ? "性别: 女" : `性别: ${data.sex}`)
  if (data.age) parts.push(`年龄: ${data.age}`)
  parts.push(`QQ: ${data.qq}`)
  parts.push(`头像: https://q.qlogo.cn/g?b=qq&s=0&nk=${data.qq}`)
  return parts.join("，")
}

function formatGroup(info) {
  const parts = []
  if (info.card) parts.push(`群昵称: ${info.card}`)
  if (info.title) parts.push(`群头衔: ${info.title}`)
  parts.push(`群身份: ${roleName(info.role)}`)
  return "（群信息：" + parts.join("，") + "）"
}

function roleName(role) {
  return { owner: "群主", admin: "群管理员", member: "群成员" }[role] || role || "群成员"
}

tools.register({
  name: "query",
  description: "Look up info about the bot owner or a specific user. Use when you want to know who you're talking to or identify your master. For your own awareness — do not disclose the result.",
  parameters: {
    type: "object",
    properties: {
      queryType: { type: "string", enum: ["master", "member"], description: "Query type: 'master' for bot admin, 'member' for a specific user" },
      group_id: { type: "number", description: "Group ID, optionally provide to get group-specific info" },
      qq: { type: "number", description: "User QQ to query. Required when queryType=member" },
    },
    required: ["queryType"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "Cannot get context"

    const { queryType, group_id, qq } = args
    const masters = cfg.master?.[e.self_id] || []

    const targetQQ = queryType === "master"
      ? masters[0]
      : qq

    if (!targetQQ) return queryType === "master"
      ? "No bot admin (master) configured"
      : "queryType=member requires 'qq' parameter"

    const isOwner = masters.map(String).includes(String(targetQQ))

    // 群信息：本地查询
    let groupData = null
    if (group_id) {
      try {
        const m = await Bot.pickMember?.(group_id, targetQQ)?.getInfo()
        if (m) groupData = { card: m.card, title: m.title, role: m.role }
      } catch { }
    }

    // 优先第三方接口
    const api = await fetchQQInfo(targetQQ)

    if (api) {
      const lines = [formatUser(api, isOwner)]
      if (groupData) lines.push(formatGroup(groupData))
      return lines.join("\n")
    }

    // 回退本地查询
    try {
      const local = { qq: targetQQ, nickname: null, sex: null, age: null }

      if (group_id && !groupData) {
        try {
          const m = await Bot.pickMember(group_id, targetQQ).getInfo()
          if (m) {
            local.nickname = m.nickname || local.nickname
            local.sex = m.sex
            local.age = m.age
            groupData = { card: m.card, title: m.title, role: m.role }
          }
        } catch { }
      }

      if (!local.nickname) {
        try {
          const f = await Bot.pickFriend(targetQQ).getInfo()
          local.nickname = f.nickname || local.nickname
          local.sex = local.sex || f.sex
          local.age = local.age || f.age
        } catch { }
      }

      if (!local.nickname) return `User ${targetQQ} not found`

      const lines = [formatUser(local, isOwner)]
      if (groupData) lines.push(formatGroup(groupData))
      return lines.join("\n")
    } catch (err) {
      log.error(`query 失败: ${err.message}`)
      return `Query failed: ${err.message}`
    }
  },
})
