import tools from "./registry.js"

tools.register({
  name: "get_current_time",
  description: "获取当前时间，默认北京时间",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "时区，如 Asia/Shanghai、America/New_York，默认 Asia/Shanghai",
      },
    },
  },
  execute: async args => {
    const tz = args?.timezone || "Asia/Shanghai"
    return new Date().toLocaleString("zh-CN", { timeZone: tz })
  },
})
