import tools from "./registry.js"

tools.register({
  name: "group_admin",
  description: "群管理操作：踢人(kick)、批量踢人(kick_batch)、禁言(ban)、解除禁言(unban)、设置群名片(set_card)、设置管理员(set_admin)、设置专属头衔(set_title)、设置群名(set_name)、全员禁言(set_whole_ban)、解除全员禁言(unset_whole_ban)、戳一戳(poke)、发送群公告(send_notice)、退出群聊(quit)。多数操作需要机器人是群管理员。",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "kick", "kick_batch", "ban", "unban",
          "set_card", "set_admin", "set_title", "set_name",
          "set_whole_ban", "unset_whole_ban",
          "poke", "send_notice", "quit",
        ],
        description: "要执行的群管理操作",
      },
      group_id: {
        type: "number",
        description: "目标群号",
      },
      user_id: {
        type: "number",
        description: "目标用户 QQ 号。kick、ban、unban、set_card、set_admin、set_title、poke 操作需要",
      },
      user_ids: {
        type: "array",
        items: { type: "number" },
        description: "要踢出的用户 QQ 号列表。kick_batch 操作需要",
      },
      duration: {
        type: "number",
        description: "禁言时长，秒。默认 300",
      },
      new_card: {
        type: "string",
        description: "新群名片。set_card 操作需要",
      },
      title: {
        type: "string",
        description: "专属头衔内容。set_title 操作需要，传空字符串可移除头衔",
      },
      enable: {
        type: "boolean",
        description: "true 设为管理员，false 取消管理员。set_admin 操作需要",
      },
      name: {
        type: "string",
        description: "新群名称。set_name 操作需要",
      },
      content: {
        type: "string",
        description: "公告内容。send_notice 操作需要",
      },
      image: {
        type: "string",
        description: "公告图片 URL，可选。send_notice 操作用",
      },
      reject_add_request: {
        type: "boolean",
        description: "踢人后是否拒绝再次加群申请，默认 false。kick、kick_batch 操作可选",
      },
    },
    required: ["action", "group_id"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "无法获取上下文"

    const { action, user_id, user_ids, duration, new_card, title, enable, name, content, image, reject_add_request, group_id } = args

    const group = Bot.pickGroup(group_id)
    if (!group) return `未找到群 ${group_id}`

    try {
      const botMember = await Bot.pickMember(group_id, e.self_id).getInfo()
      if (!botMember || (botMember.role !== "admin" && botMember.role !== "owner")) {
        return `机器人在群 ${group_id} 不是管理员，无法执行管理操作`
      }
    } catch {
      return `无法获取机器人在群 ${group_id} 的权限信息`
    }

    try {
      switch (action) {
        /* ---- 成员操作 ---- */
        case "kick": {
          if (!user_id) return "kick 操作需要提供 user_id"
          await group.kickMember(user_id, !!reject_add_request)
          return `已踢出成员 ${user_id}`
        }
        case "kick_batch": {
          if (!Array.isArray(user_ids) || !user_ids.length) return "kick_batch 操作需要提供 user_ids"
          await group.kickMembers(user_ids, !!reject_add_request)
          return `已批量踢出 ${user_ids.length} 人: ${user_ids.join(", ")}`
        }
        case "ban": {
          if (!user_id) return "ban 操作需要提供 user_id"
          await group.muteMember(user_id, duration || 300)
          return `已禁言成员 ${user_id} ${duration || 300} 秒`
        }
        case "unban": {
          if (!user_id) return "unban 操作需要提供 user_id"
          await group.muteMember(user_id, 0)
          return `已解除成员 ${user_id} 禁言`
        }
        case "poke": {
          if (!user_id) return "poke 操作需要提供 user_id"
          await group.pokeMember(user_id)
          return `已戳一戳成员 ${user_id}`
        }

        /* ---- 身份/名片操作 ---- */
        case "set_card": {
          if (!user_id) return "set_card 操作需要提供 user_id"
          await group.setCard(user_id, new_card || "")
          return `已设置成员 ${user_id} 的群名片`
        }
        case "set_admin": {
          if (!user_id) return "set_admin 操作需要提供 user_id"
          await group.setAdmin(user_id, !!enable)
          return enable ? `已将 ${user_id} 设为管理员` : `已取消 ${user_id} 的管理员`
        }
        case "set_title": {
          if (!user_id) return "set_title 操作需要提供 user_id"
          await group.setTitle(user_id, title ?? "")
          return title ? `已授予 ${user_id} 专属头衔: ${title}` : `已移除 ${user_id} 的专属头衔`
        }

        /* ---- 群设置 ---- */
        case "set_name": {
          if (!name) return "set_name 操作需要提供 name"
          await group.setName(name)
          return `群名称已改为: ${name}`
        }
        case "set_whole_ban":
          await group.muteAll(true)
          return "已开启全员禁言"
        case "unset_whole_ban":
          await group.muteAll(false)
          return "已关闭全员禁言"

        /* ---- 公告 ---- */
        case "send_notice": {
          if (!content) return "send_notice 操作需要提供 content"
          await group.sendNotice(content, image || undefined)
          return "已发送群公告"
        }

        /* ---- 退出 ---- */
        case "quit":
          await group.quit()
          return `已退出群 ${group_id}`

        default:
          return `不支持的操作: ${action}`
      }
    } catch (err) {
      return `执行 ${action} 失败: ${err.message}`
    }
  },
})
