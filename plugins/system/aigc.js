import cfg from "../../lib/config/config.js"
import runtime from "../../lib/aigc/runtime.js"
import common from "../../lib/common/common.js"
import { formatDate } from "../../lib/aigc/time.js"

const con = () => Bot.aigc.conversation
const tools = () => Bot.aigc.tools
const kb = () => Bot.aigc.knowledge
const MAX_TOOL_ROUNDS = 5

const FACE_MAP = {
  惊讶: 0, 撇嘴: 1, 色: 2, 发呆: 3, 得意: 4, 流泪: 5, 害羞: 6, 闭嘴: 7, 睡: 8,
  大哭: 9, 尴尬: 10, 发怒: 11, 调皮: 12, 呲牙: 13, 微笑: 14, 难过: 15, 酷: 16,
  抓狂: 18, 吐: 19, 偷笑: 20, 可爱: 21, 白眼: 22, 傲慢: 23, 饥饿: 24, 困: 25,
  惊恐: 26, 流汗: 27, 憨笑: 28, 悠闲: 29, 奋斗: 30, 咒骂: 31, 疑问: 32, 嘘: 33,
  晕: 34, 折磨: 35, 衰: 36, 骷髅: 37, 敲打: 38, 再见: 39, 擦汗: 40, 抠鼻: 41,
  鼓掌: 42, 糗大了: 43, 坏笑: 44, 左哼哼: 45, 右哼哼: 46, 哈欠: 47, 鄙视: 48,
  委屈: 49, 快哭了: 50, 阴险: 51, 亲亲: 52, 吓: 53, 可怜: 54, 菜刀: 55, 西瓜: 56,
  啤酒: 57, 篮球: 58, 乒乓: 59, 咖啡: 60, 饭: 61, 猪头: 62, 玫瑰: 63, 凋谢: 64,
  示爱: 65, 爱心: 66, 心碎: 67, 蛋糕: 68, 闪电: 69, 炸弹: 70, 刀: 71, 足球: 72,
  瓢虫: 73, 便便: 74, 月亮: 75, 太阳: 76, 礼物: 77, 拥抱: 78, 强: 79, 弱: 80,
  握手: 81, 胜利: 82, 抱拳: 83, 勾引: 84, 拳头: 85, 差劲: 86, 爱你: 87, NO: 88,
  OK: 89, 爱情: 90, 飞吻: 91, 跳跳: 92, 发抖: 93, 怄火: 94, 转圈: 95, 磕头: 96,
  回头: 97, 跳绳: 98, 挥手: 99, 激动: 100, 街舞: 101, 献吻: 102,
}

/** AIGC 入口：被 @ 且无命令匹配时触发，支持工具调用、长期记忆、知识库检索 */
export class AigcFallback extends plugin {
  constructor() {
    super({
      name: "AIGC",
      dsc: "AIGC 对话",
      event: "message",
      priority: 999999999,
      rule: [
        { reg: /^#关闭aigc$/i, fnc: "aigcOff" },
        { reg: /^#开启aigc$/i, fnc: "aigcOn" },
        { reg: /^#结束对话$/i, fnc: "clearMemory" },
        { reg: /^#清除记忆$/i, fnc: "clearMemory" },
        { reg: /^#知识库添加(.+)$/i, fnc: "kbAdd" },
        { reg: /^#知识库删除\s*(\S+)$/i, fnc: "kbRemove" },
        { reg: /^#知识库列表$/i, fnc: "kbList" },
        { reg: /^#知识库清除$/i, fnc: "kbClear" },
        { reg: /^(.+)$/, fnc: "aigcChat", log: false },
      ],
    })
  }

  /** 将 LLM 回复中的 [表情名] → face segment，[@QQ号] → at segment */
  _processContent(text) {
    if (typeof text !== "string" || !text) return text

    const parts = []
    let last = 0
    const re = /\[([\p{Script=Han}A-Z]+)\]|\[@(\d+)\]/gu
    let m
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: "text", data: { text: text.slice(last, m.index) } })
      if (m[1]) {
        const id = FACE_MAP[m[1]]
        parts.push(id !== undefined ? { type: "face", id } : { type: "text", data: { text: m[0] } })
      } else if (m[2]) {
        parts.push(global.segment.at(m[2]))
      }
      last = m.index + m[0].length
    }
    if (!parts.length) return text
    if (last < text.length) parts.push({ type: "text", data: { text: text.slice(last) } })
    return parts
  }

  /** 分段回复：按 <x><x><x> 拆分 */
  async _splitReply(text) {
    const parts = text.split(/<x><x><x>/)
    if (parts.length <= 1) return this.reply(text, true)
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].trim()
      if (!t) continue
      await this.reply(t, i === 0)
      if (i < parts.length - 1) await new Promise(r => setTimeout(r, 1000))
    }
  }

  reply(msg = "", quote = false, data = {}) {
    if (this.e && !this.e.isGroup) quote = false
    return super.reply(this._processContent(msg), quote, data)
  }

  /* ---------- 全局开关 ---------- */

  async aigcOff() {
    if (!this.e.isMaster) return false
    await runtime.setEnable(false)
    return this.reply("AIGC已关闭", true)
  }

  async aigcOn() {
    if (!this.e.isMaster) return false
    await runtime.setEnable(true)
    return this.reply("AIGC已开启", true)
  }

  /* ---------- 记忆 / 对话清除 ---------- */

  async clearMemory() {
    const key = con().sessionKey(
      this.e.self_id,
      this.e.user_id,
      this.e.isGroup ? this.e.group_id : "",
    )
    await Bot.aigc.memory.clear(this.e.user_id)
    await con().clearSession(key)
    logger.info(`清空会话`)
    return this.reply("AIGC记忆已清除", true)
  }

  /* ---------- 知识库管理 ---------- */

  async kbAdd() {
    if (!this.e.isMaster) return false
    const content = this.e.msg.replace(/^#知识库添加/i, "").trim()
    if (!content)
      return this.reply("请输入要添加的内容，格式：#知识库添加 <内容>", true)
    const r = await kb().add(content)
    if (r.error) return this.reply(`添加失败：${r.error}`, true)
    return this.reply(`已添加知识 [${r.id}]：${r.content}`, true)
  }

  async kbRemove() {
    if (!this.e.isMaster) return false
    const id = this.e.msg.replace(/^#知识库删除\s*/i, "").trim()
    if (!id)
      return this.reply("请输入要删除的知识 ID，格式：#知识库删除 <id>", true)
    const r = await kb().remove(id)
    if (r.error) return this.reply(`删除失败：${r.error}`, true)
    return this.reply(`已删除知识 [${r.id}]`, true)
  }

  async kbList() {
    if (!this.e.isMaster) return false
    const docs = await kb().list()
    if (!docs.length) return this.reply("知识库为空", true)
    const lines = docs.map((d) => `[${d.id}] ${d.content}`)
    return this.reply(lines.join("\n"), true)
  }

  async kbClear() {
    if (!this.e.isMaster) return false
    await kb().clear()
    return this.reply("已清除全部知识库内容", true)
  }

  /* ---------- AIGC 对话 ---------- */

  async aigcChat() {
    if (cfg.aigc?.enable === false) return
    if (this.e._synthetic) return false
    if (this.e.isPrivate && cfg.aigc?.private_enable === false && !this.e.isMaster) return false

    const blacklist = cfg.aigc?.qq_blacklist
    if (blacklist?.length) {
      const uid = String(this.e.user_id)
      for (const qq of blacklist) {
        if (String(qq) === uid) return false
      }
    }

    if (this.e.isGroup) {
      if (!this.e.atBot) return false

      // 群白名单，仅允许白名单群触发
      const whitelist = cfg.aigc?.group_whitelist
      if (whitelist?.length) {
        const gid = String(this.e.group_id)
        let matched = false
        for (const g of whitelist) {
          if (String(g) === gid) { matched = true; break }
        }
        if (!matched) return false
      }
    }

    const userMsg = this.e.msg?.trim()
    if (!userMsg) return

    const prefixFilter = cfg.aigc?.prefix_filter
    if (prefixFilter?.length) {
      for (const prefix of prefixFilter) {
        if (userMsg.startsWith(prefix)) return false
      }
    }

    // 单一用户并发锁：同一用户上一轮未结束时拒绝新请求，5 分钟自动过期
    const lockKey = `aigc:lock:${this.e.user_id}`
    if (await redis.get(lockKey)) return false
    await redis.set(lockKey, "1", { EX: 300 })

    const key = con().sessionKey(
      this.e.self_id,
      this.e.user_id,
      this.e.isGroup ? this.e.group_id : "",
    )
    const provider = cfg.aigc?.provider || "openai"
    const model = cfg.aigc?.[provider]?.model || "gpt-4o-mini"
    const gid = this.e.isGroup ? this.e.group_id : "-"

    logger.info(`chat  uid=${this.e.user_id}`)

    await con().setSystem(key, await this._buildSystem(userMsg))

    const images = this.e.img?.length ? this.e.img : null

    try {
      await this._replyLoop(key, userMsg, images)
    } catch (err) {
      logger.error(`对话异常: ${err.message}`)
      await this.reply("AIGC 服务暂时不可用，请稍后重试", true)
    } finally {
      await redis.del(lockKey)
    }
  }

  async _buildSystem(userMsg) {
    const systemPrompt = (cfg.aigc?.system_prompt || "You are AIGC-Yunzai, an intelligent chatbot assistant.")
      + (cfg.aigc?.split_reply ? `如果你想要分句回复，可以使用 <x><x><x> 分割文本，例如：第一句<x><x><x>第二句<x><x><x>第三句 ，系统会帮你拆开发送。` : "")
    const timeStr = formatDate(new Date(), "full")
    const parts = [
      `${systemPrompt}现在是${timeStr}。`,
    ]

    const memCtx = await Bot.aigc.memory.toContext(this.e.user_id)
    if (memCtx) parts.push(memCtx)

    const kbCtx = await kb().toContext(userMsg)
    if (kbCtx) parts.push(kbCtx)

    const envCtx = await this._buildEnvContext()
    if (envCtx) parts.push(envCtx)

    return parts.join("\n")
  }

  /** 构建当前聊天环境上下文：私聊/群聊、用户/群信息、最近群聊记录 */
  async _buildEnvContext() {
    const e = this.e

    if (e.isGroup) {
      let botCard = ""
      try {
        botCard = e.group?.pickMember?.(e.self_id)?.card || ""
      } catch { }
      const botName = botCard || Bot[e.self_id]?.nickname || ""

      const card = e.sender?.card || e.sender?.nickname || ""
      const role = e.member?.role || "member"
      const sex = e.member?.sex || "unknown"

      let ctx = `You are in a group chat. Group: "${e.group_name || "Unknown"}" (ID: ${e.group_id}). Your nickname in this group: ${botName}. Your QQ: ${e.self_id}. Current speaker: [${card}](qq:${e.user_id},sex:${sex},role:${role}).`

      const histCount = cfg.aigc?.group_history_count ?? 30
      if (histCount > 0) {
        const history = await this._getGroupHistory(histCount)
        if (history) {
          ctx += `\nRecent group chat history:\n${history}`
        }
      }

      return ctx
    }

    return `You are in a private chat. User: ${e.sender?.nickname || "Unknown"} (QQ: ${e.user_id}).`
  }

  /** 获取群聊最近 N 条消息，格式：[昵称](qq:xxx,性别:x,群身份:x): 消息文本 */
  async _getGroupHistory(count) {
    try {
      const e = this.e
      if (!e.group?.getChatHistory) return null

      const msgSeq = e.message_seq
      if (!msgSeq) return null

      const msgs = await e.group.getChatHistory(msgSeq, count, true)
      if (!msgs?.length) return null

      const lines = []
      for (const msg of msgs) {
        const sender = msg.sender || {}
        const name = sender.card || sender.nickname || "Unknown"
        const qq = sender.user_id || "?"
        const sex = sender.sex || "unknown"
        const role = sender.role || "member"

        const text = this._extractMsgText(msg)
        if (!text) continue

        lines.push(`[${name}](qq:${qq},sex:${sex},role:${role}): ${text}`)
      }

      return lines.length ? lines.join("\n") : null
    } catch (err) {
      logger.warn(`群聊记录获取失败: ${err.message}`)
      return null
    }
  }

  /** 从解析后的消息中提取纯文本，去除 CQ 码 */
  _extractMsgText(msg) {
    const message = msg.message
    if (!message) {
      const raw = msg.raw_message || ""
      return raw.replace(/\[CQ:[^\]]+\]/g, "").trim()
    }
    if (typeof message === "string") return message
    if (!Array.isArray(message)) return ""
    return message
      .filter((seg) => seg.type === "text")
      .map((seg) => seg.text || "")
      .join("")
  }

  /** 工具调用循环：LLM → tool_calls → 执行 → 回传结果，直到文本回复或超限 */
  async _replyLoop(sessionKey, userMsg, images) {
    let userSaved = false

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let messages = await con().getMessages(sessionKey)
      if (!userSaved) {
        const um = { role: "user", content: userMsg }
        if (images) um.images = images
        messages = [...messages, um]
      }

      const opts = {}
      const toolDefs = tools().getDefinitions()
      if (toolDefs.length) {
        opts.tools = toolDefs
        opts.tool_choice = "auto"
      }

      const res = await Bot.aigc.provider.chat(messages, opts)

      // Gemini 安全拦截 → 不存记忆，直接结束
      if (res.blocked) {
        logger.warn(`安全拦截  ${res.finishReason}`)
        return this.reply("内容被安全策略拦截", true)
      }

      if (res.tool_calls?.length) {
        if (res.content) {
          await this._splitReply(res.content)
        }
        const names = res.tool_calls
          .map((c) => c.function?.name)
          .filter(Boolean)
          .join(",")
        logger.info(`工具调用: ${names}`)

        if (!userSaved) {
          await con().addMessage(
            sessionKey,
            "user",
            userMsg,
            images ? { images } : {},
          )
          userSaved = true
        }
        await con().addMessage(sessionKey, "assistant", res.content || null, {
          tool_calls: res.tool_calls,
          ...(res.reasoning_content && {
            reasoning_content: res.reasoning_content,
          }),
        })

        const results = await tools().executeAll(res.tool_calls, {
          user_id: this.e.user_id,
          event: this.e,
        })
        for (let i = 0; i < results.length; i++) {
          const r = results[i]
          const callId = res.tool_calls[i]?.id || `call_${i}`
          const payload = "error" in r ? r.error : r.result
          await con().addMessage(
            sessionKey,
            "tool",
            JSON.stringify(payload ?? ""),
            { tool_call_id: callId },
          )
        }
        continue
      }

      if (res.content) {
        if (!userSaved)
          await con().addMessage(
            sessionKey,
            "user",
            userMsg,
            images ? { images } : {},
          )
        await con().addMessage(
          sessionKey,
          "assistant",
          res.content,
          res.reasoning_content
            ? { reasoning_content: res.reasoning_content }
            : {},
        )

        if (res.reasoning_content && cfg.aigc?.show_thinking) {
          const thinkingMsg = await common.makeForwardMsg(this.e, [
            { type: "text", data: { text: res.reasoning_content } },
          ])
          await this.reply(thinkingMsg, true)
        }

        return this._splitReply(res.content)
      }
      // 空响应 (非 blocked) → 不存记忆
      logger.warn(`空响应`)
      return
    }

    // 工具调用轮数超限，强制获取文本回复 (不带 tools)
    logger.warn(`超限`)
    const finalReply = await Bot.aigc.provider.chat(
      await con().getMessages(sessionKey),
    )
    if (finalReply.content) {
      await con().addMessage(
        sessionKey,
        "assistant",
        finalReply.content,
        finalReply.reasoning_content
          ? { reasoning_content: finalReply.reasoning_content }
          : {},
      )
      logger.info(`超限回复`)
      return this._splitReply(finalReply.content)
    }

    logger.error(`全部失败`)
    return this.reply("处理超时，请稍后再试", true)
  }
}
