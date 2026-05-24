/** Agent 工具注册中心，工具规范: { name, description, parameters, execute(args) } */
class ToolRegistry {
  constructor() {
    this.tools = new Map()
  }

  register(tool) {
    if (!tool.name || !tool.execute) throw new Error("Tool 必须包含 name 和 execute")
    this.tools.set(tool.name, tool)
  }

  registerAll(tools) {
    for (const t of tools) this.register(t)
  }

  unregister(name) {
    this.tools.delete(name)
  }

  /** 导出为 OpenAI Function Calling 格式 */
  getDefinitions(filterNames) {
    const list = []
    for (const [name, tool] of this.tools) {
      if (filterNames && !filterNames.includes(name)) continue
      list.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: tool.parameters || { type: "object", properties: {} },
        },
      })
    }
    return list
  }

  async execute(name, args, ctx) {
    const tool = this.tools.get(name)
    if (!tool) return { error: `Unknown tool: ${name}` }
    try {
      const result = await tool.execute(args, ctx)
      logger.info(`[aigc] tool ${name}  args=${JSON.stringify(args).slice(0, 120)}`)
      return { name, result }
    } catch (err) {
      logger.error(`[aigc] tool ${name}  err=${err.message}`)
      return { name, error: err.message }
    }
  }

  async executeAll(toolCalls, ctx) {
    const results = []
    for (const call of toolCalls) {
      const name = call?.function?.name
      if (!name) {
        results.push({ name: "unknown", error: "tool_calls missing function.name" })
        continue
      }
      let args = {}
      try { args = JSON.parse(call.function?.arguments || "{}") } catch { /* pass */ }
      results.push(await this.execute(name, args, ctx))
    }
    return results
  }

  list() {
    const result = []
    for (const [name, tool] of this.tools)
      result.push({ name, description: tool.description })
    return result
  }
}

export default new ToolRegistry()
