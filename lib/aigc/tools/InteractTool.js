import tools from "./registry.js"

tools.register({
  name: "interact",
  description: "Send a friendly interaction: like (点赞, works anywhere) or poke (戳一戳, different for private/group). Default target is the current speaker.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["like", "poke"],
        description: "like=点赞, poke=戳一戳",
      },
      target_qq: {
        type: "number",
        description: "Target user QQ. Defaults to current speaker",
      },
    },
    required: ["action"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "Cannot get context"

    const { action, target_qq } = args
    const target = target_qq || e.user_id

    // 点赞不分私聊群聊，统一用 friend.thumbUp
    if (action === "like") {
      try {
        const friend = Bot.pickFriend(target)
        if (!friend) return `未找到用户 ${target}`
        await friend.thumbUp?.(1)
        return `已给用户 ${target} 点赞`
      } catch (err) {
        return `点赞失败: ${err.message}`
      }
    }

    // 戳一戳分私聊/群聊
    if (action === "poke") {
      try {
        if (e.isGroup) {
          const member = Bot.pickMember(e.group_id, target)
          if (!member) return `未在群内找到用户 ${target}`
          await member.poke?.()
        } else {
          const friend = Bot.pickFriend(target)
          if (!friend) return `未找到用户 ${target}`
          await friend.poke?.()
        }
        return `已戳一戳用户 ${target}`
      } catch (err) {
        return `戳一戳失败: ${err.message}`
      }
    }

    return `Unknown action: ${action}`
  },
})
