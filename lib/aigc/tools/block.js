import tools from "./registry.js"
import runtime from "../runtime.js"

tools.register({
  name: "block_user",
  description: "将指定用户加入 AIGC 黑名单，禁止其使用 AIGC 对话功能。",
  parameters: {
    type: "object",
    properties: {
      target_qq: {
        type: "string",
        description: "要拉黑的用户 QQ 号",
      },
    },
    required: ["target_qq"],
  },
  execute: async (args, ctx) => {
    const { target_qq } = args
    if (!target_qq) return "请提供有效的 QQ 号"

    try {
      const added = await runtime.addBlacklist(target_qq)
      if (!added) return `用户 ${target_qq} 已在黑名单中`
      return `已将用户 ${target_qq} 加入 AIGC 黑名单`
    } catch (err) {
      logger.error(`[aigc] block_user  err=${err.message}`)
      return `拉黑失败: ${err.message}`
    }
  },
})
