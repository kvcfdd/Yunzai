import tools from "./registry.js"

tools.register({
  name: "get_current_time",
  description: "获取当前日期和时间",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "时区，如 Asia/Shanghai，默认 Asia/Shanghai",
      },
    },
  },
  execute: async args => {
    const tz = args?.timezone || "Asia/Shanghai"
    return new Date().toLocaleString("zh-CN", { timeZone: tz })
  },
})

tools.register({
  name: "calculate",
  description: "执行数学计算",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "数学表达式，如 '2 + 3 * 4'",
      },
    },
    required: ["expression"],
  },
  execute: async args => {
    const expr = args.expression
    if (!/^[\d\s+\-*/().%]+$/.test(expr)) return "表达式包含不允许的字符"
    try {
      return String(new Function(`return (${expr})`)())
    } catch {
      return "计算错误"
    }
  },
})
