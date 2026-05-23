import PluginsLoader from "../../plugins/loader.js"
import tools from "./registry.js"

tools.register({
  name: "use_bot_feature",
  description: "调用机器人内置功能。用户要求执行某个操作时使用此工具。",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "要调用的命令及参数,注意携带相应前缀，如 '绑定uid 123456'、'天气 北京'",
      },
    },
    required: ["command"],
  },
  execute: async (args, ctx) => {
    const realEvent = ctx?.event
    if (!realEvent) return "无法获取用户上下文"

    const cmd = args.command.trim()
    let captured = ""
    let sent = false

    // 合成事件，reply：纯文本捕获 → LLM 加工；富媒体/转发 → 直接发给用户
    const e = {
      user_id: realEvent.user_id,
      group_id: realEvent.group_id,
      self_id: realEvent.self_id,
      isGroup: realEvent.isGroup,
      isPrivate: realEvent.isPrivate,
      isMaster: realEvent.isMaster,
      msg: cmd,
      reply: async (msg, quote, data) => {
        if (typeof msg === "string") {
          captured = msg
          return { message_id: "aigc-tool" }
        }
        sent = true
        return realEvent.reply(msg, quote, data)
      },
    }

    // 按优先级遍历插件，命中第一个匹配的规则
    const candidates = [cmd]
    if (!cmd.startsWith("#")) candidates.push(`#${cmd}`)

    for (const c of candidates) {
      for (const { plugin: p, class: PluginClass } of PluginsLoader.priority) {
        if (!p.rule) continue
        for (const rule of p.rule) {
          if (rule.fnc === "aigcChat") continue
          if (!rule.reg.test(c)) continue

          try {
            const instance = new PluginClass()
            instance.e = { ...e, msg: c }
            await instance[rule.fnc]()
          } catch (err) {
            logger.error(`[aigc] plugin tool  ${p.name}/${rule.fnc}  err=${err.message}`)
            return `功能执行出错: ${err.message}`
          }

          logger.mark(`[aigc] plugin tool  ${p.name}/${rule.fnc}  cmd=${c}`)
          if (sent) return "[已直接回复]"
          return captured || "功能已执行"
        }
      }
    }

    return "未找到匹配的功能，请检查命令格式"
  },
})
