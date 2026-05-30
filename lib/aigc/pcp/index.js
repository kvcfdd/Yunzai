/**
 * PCP Manager: 插件能力协议管理器
 *
 * 监听 Loader 发射的 plugin:loaded / plugin:unloaded 事件，
 * 自动将插件的 tools[] 声明展开为完整 Tool 定义并注册到 ToolRegistry。
 *
 * 与 MCP Manager 对称 —— MCP 从外部发现工具，PCP 从本地插件发现工具。
 * 两者共享同一个 ToolRegistry，LLM 无差别调用。
 */

import tools from "../tools/registry.js"
import { expandToolDef } from "./bridge.js"
import log from "../helpers/log.js"

class PcpManager {
  /** pluginKey → [{ registeredName, className, decl }] */
  #registry = new Map()

  /** 是否已开始监听（init 只执行一次） */
  #started = false

  init() {
    if (this.#started) return
    this.#started = true

    Bot.on("plugin:loaded", this.#onLoaded.bind(this))
    Bot.on("plugin:unloaded", this.#onUnloaded.bind(this))

    log.info("PCP 协议已就绪，等待插件加载")
  }

  #onLoaded({ key, className, instance }) {
    if (!instance?.tools?.length) return

    // 热更新: 只注销同 class 的旧工具（同一 key 下可能有多个 class 入口）
    const existing = this.#registry.get(key)
    if (existing) {
      const sameClass = existing.filter(e => e.className === className)
      const otherClass = existing.filter(e => e.className !== className)
      for (const { registeredName } of sameClass) {
        tools.unregister(registeredName)
        log.debug(`PCP 注销旧工具: ${registeredName}`)
      }
      if (otherClass.length) {
        this.#registry.set(key, otherClass)
      } else {
        this.#registry.delete(key)
      }
    }

    const registered = []
    for (const decl of instance.tools) {
      if (!decl.fnc || !decl.description) {
        log.warn(`PCP 跳过无效声明 [${key}]: 缺少 fnc 或 description`)
        continue
      }

      try {
        const full = expandToolDef(key, className, decl)
        tools.register(full)
        registered.push({ registeredName: full.name, className, decl })
        log.debug(`PCP 注册: ${full.name}`)
      } catch (err) {
        log.error(`PCP 注册失败 [${key}]: ${err.message}`)
      }
    }

    if (registered.length) {
      const updated = (this.#registry.get(key) || []).concat(registered)
      this.#registry.set(key, updated)
      const names = registered.map(r => r.registeredName).join(", ")
      log.info(`PCP 注册 [${instance.name || key}]: ${names}`)
    }
  }

  #onUnloaded({ key }) {
    const entries = this.#registry.get(key)
    if (!entries?.length) return

    for (const { registeredName } of entries) {
      tools.unregister(registeredName)
    }
    const names = entries.map(e => e.registeredName).join(", ")
    log.info(`PCP 注销 [${key}]: ${names}`)
    this.#registry.delete(key)
  }
}

export default new PcpManager()
