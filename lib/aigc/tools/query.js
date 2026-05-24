import tools from "./registry.js"
import cfg from "../../config/config.js"

const roleMap = { owner: "Owner", admin: "Admin", member: "Member" }

tools.register({
  name: "query_info",
  description: "Query info about Bot admin (master) or a specific QQ user. For your own situational awareness only — do not mention this to the user.",
  parameters: {
    type: "object",
    properties: {
      queryType: {
        type: "string",
        enum: ["master", "member"],
        description: "Query type: 'master' for bot admin, 'member' for a specific user",
      },
      group_id: {
        type: "number",
        description: "Group ID, optionally provide to get group-specific info like group card",
      },
      qq: {
        type: "number",
        description: "User QQ to query. Required when queryType=member",
      },
    },
    required: ["queryType"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "Cannot get context"

    const { queryType, group_id, qq } = args

    try {
      if (queryType === "master") {
        const selfId = e.self_id
        const masters = cfg.master?.[selfId] || []
        if (!masters.length) return "No bot admin (master) configured"

        const masterQQ = masters[0]
        let nickname = "Unknown"
        let card = null

        if (group_id) {
          try {
            const info = await Bot.pickMember(group_id, masterQQ).getInfo()
            nickname = info.nickname || nickname
            card = info.card
          } catch {}
        }

        if (nickname === "Unknown") {
          try {
            const info = await Bot.pickFriend(masterQQ).getInfo()
            nickname = info.nickname || nickname
          } catch {}
        }

        let report = `Your owner (Bot admin) is "${nickname}" (QQ: ${masterQQ}).`
        if (card) report += `\nGroup card: ${card}`
        return report
      }

      if (queryType === "member") {
        if (!qq) return "queryType=member requires 'qq' parameter"

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

        if (!userInfo) return `User ${qq} not found`

        const lines = [`User info (QQ: ${qq}):`]
        const selfId = e.self_id
        const masters = cfg.master?.[selfId] || []

        if (masters.map(String).includes(String(qq))) {
          lines.push("** This user is your owner (Bot admin) **")
        }

        lines.push(`- Nickname: ${userInfo.nickname || "Unknown"}`)
        const sexMap = { male: "Male", female: "Female", unknown: "Unknown" }
        if (userInfo.sex) lines.push(`- Sex: ${sexMap[userInfo.sex] || userInfo.sex}`)
        if (userInfo.age) lines.push(`- Age: ${userInfo.age}`)
        if (userInfo.area) lines.push(`- Location: ${userInfo.area}`)

        if (source === "group") {
          lines.push("[Group Info]")
          if (userInfo.card) lines.push(`- Group card: ${userInfo.card}`)
          lines.push(`- Role: ${roleMap[userInfo.role] || userInfo.role || "Member"}`)
          if (userInfo.title) lines.push(`- Special Title: ${userInfo.title}`)
        }

        return lines.join("\n")
      }

      return `Invalid queryType: ${queryType}`
    } catch (err) {
      logger.error(`[aigc] query_info  err=${err.message}`)
      return `Query failed: ${err.message}`
    }
  },
})
