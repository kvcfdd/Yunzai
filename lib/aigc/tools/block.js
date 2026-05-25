import tools from "./registry.js"
import runtime from "../runtime.js"

tools.register({
  name: "block_user",
  description: "Block/blacklist a specified user from using AIGC",
  parameters: {
    type: "object",
    properties: {
      target_qq: {
        type: "string",
        description: "QQ number of the user to block",
      },
    },
    required: ["target_qq"],
  },
  execute: async (args, ctx) => {
    const { target_qq } = args
    if (!target_qq) return "Please provide a valid QQ number"

    try {
      const added = await runtime.addBlacklist(target_qq)
      if (!added) return `User ${target_qq} is already blacklisted`
      return `User ${target_qq} has been added to AIGC blacklist`
    } catch (err) {
      logger.error(`block_user 失败: ${err.message}`)
      return `Block failed: ${err.message}`
    }
  },
})
