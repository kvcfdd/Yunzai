import tools from "./registry.js"
import memory from "../memory.js"

const LIMIT = 30

tools.register({
  name: "memory",
  description: `Persistent memory for the current user. Save things worth remembering long-term, delete things that are wrong or outdated. Memories are automatically included in future conversations — no need to recall them first. Max ${LIMIT} entries per user.`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["save", "delete"],
        description: "'save' to remember a fact, 'delete' to forget one",
      },
      key: { type: "string", description: "A short label summarizing what this memory is about" },
      value: { type: "string", description: "The fact worth remembering (max 100 chars). Required for: save" },
    },
    required: ["action", "key"],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "Cannot get user ID"

    const { action, key, value } = args

    switch (action) {
      case "save": {
        if (!value) return "save requires 'value'"
        const ok = await memory.set(ctx.user_id, key, value)
        if (!ok) return "Value is empty — nothing saved"
        return `Saved: ${key}`
      }
      case "delete": {
        await memory.del(ctx.user_id, key)
        return `Deleted: ${key}`
      }
      default:
        return `Unsupported action: ${action}`
    }
  },
})
