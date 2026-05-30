/**
 * PCP Bridge: 最小声明 → 完整 Tool 定义转换器
 *
 * 插件写:
 *   tools: [{ fnc: "getStatus", description: "查看机器人状态" }]
 *
 * Bridge 自动生成:
 *   { name, description, parameters, execute }
 *
 * execute 自动处理: 权限校验 → 实例创建 → 方法调用
 */

import cfg from "../../config/config.js"
import { expandParams } from "./schema.js"

const MAX_NAME_LEN = 64
const NAME_RE = /[^a-zA-Z0-9_-]/g

/** 工具名清理: 去非法字符 → 限长 → 保证唯一 */
function sanitize(name) {
  let cleaned = String(name).replace(NAME_RE, "_").replace(/^_+|_+$/g, "")
  if (!cleaned) cleaned = "x"
  if (cleaned.length <= MAX_NAME_LEN) return cleaned

  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  const suffix = "_" + Math.abs(hash).toString(36).slice(0, 6)
  return cleaned.slice(0, MAX_NAME_LEN - suffix.length) + suffix
}

/** 权限校验：复用现有规则，但不直接 reply（LLM 语境下不宜由系统发消息） */
function checkPermission(perm, e) {
  if (!perm || perm === "all") return true
  if (e.isMaster) return true
  if (perm === "master") return false
  if (!e.isGroup) return false
  if (perm === "owner" && !e.member?.is_owner) return false
  if (perm === "admin" && !e.member?.is_owner && !e.member?.is_admin) return false
  return true
}

const PERM_MSG = {
  master: "仅 bot 主人可用",
  owner: "仅群主可用",
  admin: "仅群管理员可用",
}

/**
 * 将插件最小声明展开为完整 Tool 定义
 * @param {string} pluginKey  "status/status"
 * @param {Function} ClassName 插件类构造函数
 * @param {object} decl  { fnc, description, params?, permission?, reply? }
 * @returns {object}  { name, description, parameters, execute }
 */
export function expandToolDef(pluginKey, ClassName, decl) {
  // 从 pluginKey 提取干净的插件标识
  const pluginId = pluginKey.replace(/[/\\]/g, "_").replace(/\.[^.]+$/, "")
  const toolName = sanitize(`${pluginId}_${decl.fnc}`)

  // 展开 params → JSON Schema
  const parameters = expandParams(decl.params)

  // 权限说明拼入 description（帮助 LLM 判断是否调用）
  const permNote = decl.permission && decl.permission !== "all"
    ? ` [需要权限: ${decl.permission}]`
    : ""
  const description = (decl.description || "") + permNote

  // 自动生成 execute wrapper
  const execute = async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "无法获取消息上下文"

    if (decl.permission && decl.permission !== "all") {
      if (!checkPermission(decl.permission, e)) {
        return PERM_MSG[decl.permission] || `权限不足 (需要 ${decl.permission})`
      }
    }

    let inst
    try {
      inst = new ClassName()
    } catch {
      return "插件实例化失败"
    }
    inst.e = e

    if (typeof inst[decl.fnc] !== "function") {
      return `插件方法不存在: ${decl.fnc}`
    }

    try {
      const result = await inst[decl.fnc](args, ctx)
      if (decl.reply) return "[已发送]"
      return result ?? "[完成]"
    } catch (err) {
      return `执行失败: ${err.message}`
    }
  }

  return { name: toolName, description, parameters, execute }
}
