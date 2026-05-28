import tools from "./registry.js"
import memory from "../memory.js"

const LIMIT = 50

tools.register({
  name: "remember",
  description: "Save a fact about the current user to persistent memory. Keys are normalized (lowercase, underscores). Max 50 entries per user — use forget to make room. This memory is automatically injected into future conversations.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Label for this memory, e.g. name, hobby, preferences" },
      value: { type: "string", description: "The fact to remember. Max 800 chars." },
    },
    required: ["key", "value"],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "Cannot get user ID"
    const ok = await memory.set(ctx.user_id, args.key, args.value)
    if (!ok) return "Value is empty — nothing saved"
    return `Remembered: ${args.key}`
  },
})

tools.register({
  name: "forget",
  description: "Delete a memory entry for the current user by its key.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Memory key to delete" },
    },
    required: ["key"],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "Cannot get user ID"
    await memory.del(ctx.user_id, args.key)
    return `Forgot: ${args.key}`
  },
})

tools.register({
  name: "recall_memory",
  description: `List all existing memories for the current user. Check this before remembering new facts to avoid duplicates, before answering questions to leverage what you already know, or when you need to see what's stored. Limit: ${LIMIT} entries per user.`,
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "Cannot get user ID"
    const mems = await memory.getAll(ctx.user_id)
    if (!Object.keys(mems).length) return "No memories stored for this user yet"
    return Object.entries(mems)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n")
  },
})
