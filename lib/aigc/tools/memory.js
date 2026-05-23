import tools from "./registry.js"
import memory from "../memory.js"

tools.register({
  name: "memory_set",
  description: "记住关于当前用户的一个事实，保存到长期记忆中",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "事实的简短名称，如 名字、爱好、职业" },
      value: { type: "string", description: "事实内容" },
    },
    required: ["key", "value"],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "无法获取用户ID"
    await memory.set(ctx.user_id, args.key, args.value)
    return `已记住: ${args.key} = ${args.value}`
  },
})

tools.register({
  name: "memory_del",
  description: "删除当前用户的一条长期记忆",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "要删除的记忆名称" },
    },
    required: ["key"],
  },
  execute: async (args, ctx) => {
    if (!ctx?.user_id) return "无法获取用户ID"
    await memory.del(ctx.user_id, args.key)
    return `已删除记忆: ${args.key}`
  },
})
