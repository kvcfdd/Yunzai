import fs from "node:fs"
import path from "node:path"
import tools from "./registry.js"

function loadCommands() {
  const filePath = path.join(process.cwd(), "commands.json")
  if (!fs.existsSync(filePath)) return []

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")).commands || []
  } catch {
    return []
  }
}

tools.register({
  name: "list_commands",
  description:
    "List available bot commands/features. Use this to discover what the bot can do, " +
    "or when the user asks for help / 'what can you do' / similar queries. " +
    "Returns matching commands by keyword search.",
  parameters: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "Optional keyword to filter commands. Omit to list all.",
      },
    },
    required: [],
  },
  execute: async (args) => {
    const commands = loadCommands()
    if (!commands.length) return "No commands configured."

    let list = commands
    if (args?.keyword) {
      const kw = args.keyword.toLowerCase()
      list = commands.filter(
        c => c.command.toLowerCase().includes(kw) || c.description.toLowerCase().includes(kw),
      )
    }

    if (!list.length) return `No commands matching "${args.keyword}" found.`

    const lines = [`${list.length} command(s):`, ""]
    for (const c of list) {
      const prefixes = c.prefix.join("|")
      const plist = c.params || []
      const before = plist.filter(p => p.position === "before")
      const after = plist.filter(p => p.position !== "before")

      const wrap = p => p.required ? `<${p.name}>` : `[${p.name}]`
      const beforeStr = before.map(wrap).join("")
      const afterStr = after.map(wrap).join(" ")

      const cmd = `${beforeStr}${c.command}${afterStr ? " " + afterStr : ""}`
      lines.push(
        `- \`{${prefixes}}${cmd}\` — ${c.description}` +
        (plist.length ? ` | Params: ${plist.map(p => `${p.name}(${p.desc})`).join(", ")}` : ""),
      )
    }

    return lines.join("\n")
  },
})
