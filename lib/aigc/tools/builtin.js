import tools from "./registry.js"

tools.register({
  name: "get_current_time",
  description: "Get the current time. Uses Beijing time (Asia/Shanghai) by default",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "Timezone, e.g. Asia/Shanghai, America/New_York. Default: Asia/Shanghai",
      },
    },
    required: [],
  },
  execute: async args => {
    const tz = args?.timezone || "Asia/Shanghai"
    return new Date().toLocaleString("en-US", { timeZone: tz })
  },
})
