import tools from "./registry.js"
import memory from "../memory.js"

tools.register({
  name: "memory_set",
  description: "Remember a fact about the current user. Saves to long-term memory",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short name for this fact, e.g. name, hobby, job" },
      value: { type: "string", description: "The fact content" },
    },
    required: ["key", "value"],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "Cannot get user ID"
    await memory.set(ctx.user_id, args.key, args.value)
    return `Remembered: ${args.key} = ${args.value}`
  },
})

tools.register({
  name: "memory_del",
  description: "Delete a long-term memory entry for the current user",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Name of the memory entry to delete" },
    },
    required: ["key"],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "Cannot get user ID"
    await memory.del(ctx.user_id, args.key)
    return `Deleted memory: ${args.key}`
  },
})
