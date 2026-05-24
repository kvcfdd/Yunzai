import tools from "./registry.js"
import PluginsLoader from "../../plugins/loader.js"

function classifyReply(msg) {
  if (!msg) return { type: "empty", summary: "no output" }

  const segments = Array.isArray(msg) ? msg : [{ type: "text", data: { text: String(msg) } }]

  const types = new Set()
  const texts = []

  for (const seg of segments) {
    if (seg.type === "text" && seg.data?.text) {
      texts.push(seg.data.text)
      types.add("text")
    } else if (seg.type === "image") {
      types.add("image")
    } else if (seg.type === "video") {
      types.add("video")
    } else if (seg.type === "record") {
      types.add("record")
    } else if (seg.type === "music") {
      types.add("music")
    } else if (seg.type === "xml" || seg.type === "json") {
      types.add("data")
    } else if (seg.type === "at" || seg.type === "reply" || seg.type === "face") {
      types.add("text")
    } else {
      types.add("other")
    }
  }

  const nonText = [...types].filter((t) => t !== "text")
  const primaryType =
    types.size === 0 ? "empty"
    : types.size === 1 && types.has("text") ? "text"
    : nonText.length === 1 ? nonText[0]
    : "mixed"

  const summary = (() => {
    switch (primaryType) {
      case "text": return "[text] " + texts.join(" ").slice(0, 500)
      case "image": return "[image sent]"
      case "video": return "[video sent]"
      case "record": return "[voice/record sent]"
      case "music": return "[music card sent]"
      case "data": return "[structured data sent]"
      case "mixed": return `[mixed: ${[...types].join(", ")}]`
      case "empty": return "[no output]"
      default: return `[${primaryType} sent]`
    }
  })()

  return { type: primaryType, summary, texts }
}

tools.register({
  name: "invoke_command",
  description:
    "Invoke a bot command on behalf of the user. First use list_commands to find the right command, " +
    "then construct the full command string using the prefix+command+params pattern shown. " +
    "Only use this when the user explicitly asks to execute a command, or when it's clearly the " +
    "best way to fulfill their request.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Full command string to execute, including prefix. " +
          "E.g. '#更新面板123456789', '#星铁更新面板', '#帮助'. " +
          "Use the prefix/command patterns from list_commands.",
      },
    },
    required: ["command"],
  },
  execute: async (args, ctx) => {
    const origEvent = ctx?.event
    if (!origEvent) return "Cannot get context"

    const commandStr = args.command.trim()

    const synthEvent = { ...origEvent }

    // dealEvent() reads from e.message[] to populate e.msg
    // Do NOT preset e.msg — dealEvent appends, causing duplicate concatenation
    synthEvent.message = [{ type: "text", text: commandStr }]
    synthEvent.raw_message = commandStr
    delete synthEvent.msg
    delete synthEvent.img
    synthEvent.at = undefined
    synthEvent.atBot = undefined
    synthEvent._synthetic = true

    const captured = []
    synthEvent.reply = async (msg) => {
      captured.push(msg)
      return { message_id: "synth_" + captured.length }
    }

    try {
      await PluginsLoader.deal(synthEvent)
    } catch (err) {
      logger.error(`[aigc] invoke_command  err=${err.message}`)
      return `Command execution error: ${err.message}`
    }

    if (!captured.length) {
      return `Command "${commandStr}" produced no output. It may not match any plugin.`
    }

    const results = captured.map(classifyReply)

    const llmParts = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.type === "text") {
        llmParts.push(r.texts.join("\n"))
      } else {
        try {
          await origEvent.reply(captured[i])
        } catch (err) {
          logger.warn(`[aigc] invoke_command forward failed: ${err.message}`)
        }
        llmParts.push(r.summary)
      }
    }

    const llmText = llmParts.join("\n").trim()
    return llmText.length > 2000 ? llmText.slice(0, 1997) + "..." : llmText
  },
})
