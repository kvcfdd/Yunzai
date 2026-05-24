import fs from "node:fs"
import path from "node:path"
import tools from "./registry.js"

function loadCommands() {
  const filePath = path.join(process.cwd(), "commands.json")
  if (!fs.existsSync(filePath)) return []

  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(raw).commands || []
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
        description:
          "Optional keyword to filter commands by name, description, or plugin. " +
          "Omit to list all commands.",
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
        (c) =>
          c.command.toLowerCase().includes(kw) ||
          c.description.toLowerCase().includes(kw),
      )
    }

    if (!list.length)
      return `No commands matching "${args.keyword}" found.`

    const lines = [`${list.length} command(s):`, ""]
    for (const c of list) {
      const prefixes = c.prefix.join("|")
      const params = c.params?.length
        ? " " + c.params.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`)).join(" ")
        : ""
      lines.push(
        `- \`{${prefixes}}${c.command}${params}\` — ${c.description}` +
          (c.params?.length
            ? ` | Params: ${c.params.map((p) => `${p.name}(${p.desc})`).join(", ")}`
            : ""),
      )
    }

    return lines.join("\n")
  },
})
