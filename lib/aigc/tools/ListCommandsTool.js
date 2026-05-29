import fs from "node:fs"
import path from "node:path"
import tools from "./registry.js"

const MD_PATH = path.join(process.cwd(), "commands.md")

tools.register({
  name: "list_commands",
  description: "Read the bot command documentation. Returns the full commands.md file with all available commands, their formats, parameters, and examples.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    if (!fs.existsSync(MD_PATH)) return "commands.md not found."

    try {
      return fs.readFileSync(MD_PATH, "utf-8")
    } catch (err) {
      return `Failed to read commands.md: ${err.message}`
    }
  },
})
