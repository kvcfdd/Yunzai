import tools from "./registry.js"
import cfg from "../../config/config.js"

const roleMap = { owner: "群主", admin: "管理员", member: "群成员" }

tools.register({
  name: "query_info",
  description: "查询 Bot 管理员(master)或指定 QQ 用户的信息。仅供你辅助认知使用，不要向用户解释此功能。",
  parameters: {
    type: "object",
    properties: {
      queryType: {
        type: "string",
        enum: ["master", "member"],
        description: "查询类型：master 查管理员，member 查指定用户",
      },
      group_id: {
        type: "number",
        description: "群号，群内查询时可提供以获取群名片等信息",
      },
      qq: {
        type: "number",
        description: "要查询的用户 QQ。queryType=member 时需要",
      },
    },
    required: ["queryType"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "无法获取上下文"

    const { queryType, group_id, qq } = args

    try {
      if (queryType === "master") {
        const selfId = e.self_id
        const masters = cfg.master?.[selfId] || []
        if (!masters.length) return "未设置 Bot 管理员 (master)"

        const masterQQ = masters[0]
        let nickname = "未知"
        let card = null

        if (group_id) {
          try {
            const info = await Bot.pickMember(group_id, masterQQ).getInfo()
            nickname = info.nickname || nickname
            card = info.card
          } catch {}
        }

        if (nickname === "未知") {
          try {
            const info = await Bot.pickFriend(masterQQ).getInfo()
            nickname = info.nickname || nickname
          } catch {}
        }

        let report = `你的主人 (Bot 管理员) 是 "${nickname}" (QQ: ${masterQQ})。`
        if (card) report += `\n本群名片: ${card}`
        return report
      }

      if (queryType === "member") {
        if (!qq) return "member 查询需要提供 qq"

        let userInfo = null
        let source = "global"

        if (group_id) {
          try {
            userInfo = await Bot.pickMember(group_id, qq).getInfo()
            source = "group"
          } catch {}
        }

        if (!userInfo) {
          try {
            userInfo = await Bot.pickFriend(qq).getInfo()
            source = "global"
          } catch {}
        }

        if (!userInfo) return `未找到用户 ${qq} 的信息`

        const lines = [`用户信息 (QQ: ${qq}):`]
        const selfId = e.self_id
        const masters = cfg.master?.[selfId] || []

        if (masters.map(String).includes(String(qq))) {
          lines.push("** 此人是你的主人 (Bot 管理员) **")
        }

        lines.push(`- 昵称: ${userInfo.nickname || "未知"}`)
        const sexMap = { male: "男", female: "女", unknown: "未知" }
        if (userInfo.sex) lines.push(`- 性别: ${sexMap[userInfo.sex] || userInfo.sex}`)
        if (userInfo.age) lines.push(`- 年龄: ${userInfo.age}`)
        if (userInfo.area) lines.push(`- 地区: ${userInfo.area}`)

        if (source === "group") {
          lines.push("[群内信息]")
          if (userInfo.card) lines.push(`- 群名片: ${userInfo.card}`)
          lines.push(`- 群身份: ${roleMap[userInfo.role] || userInfo.role || "群成员"}`)
          if (userInfo.title) lines.push(`- 头衔: ${userInfo.title}`)
        }

        return lines.join("\n")
      }

      return `无效的查询类型: ${queryType}`
    } catch (err) {
      logger.error(`[aigc] query_info  err=${err.message}`)
      return `查询失败: ${err.message}`
    }
  },
})
