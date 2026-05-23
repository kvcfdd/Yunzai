import cfg from "../../lib/config/config.js"

const con = () => Bot.aigc.conversation
const tools = () => Bot.aigc.tools
const kb = () => Bot.aigc.knowledge
const MAX_TOOL_ROUNDS = 5

/** AIGC 回退入口：被 @ 且无命令匹配时触发，支持工具调用、长期记忆、知识库检索 */
export class AigcFallback extends plugin {
  constructor() {
    super({
      name: "AIGC回退",
      dsc: "被 @ 且无命令匹配时自动进入 AIGC 对话",
      event: "message",
      priority: 99999,
      rule: [
        { reg: /^#关闭aigc$/i, fnc: "aigcOff" },
        { reg: /^#开启aigc$/i, fnc: "aigcOn" },
        { reg: /^#清除记忆$/i, fnc: "clearMemory" },
        { reg: /^#清除对话$/i, fnc: "clearMemory" },
        { reg: /^#知识库添加(.+)$/i, fnc: "kbAdd" },
        { reg: /^#知识库删除\s*(\S+)$/i, fnc: "kbRemove" },
        { reg: /^#知识库列表$/i, fnc: "kbList" },
        { reg: /^#知识库清除$/i, fnc: "kbClear" },
        { reg: /^(.+)$/, fnc: "aigcChat", log: false },
      ],
    })
  }

  /* ---------- 全局开关 ---------- */

  async aigcOff() {
    if (!this.e.isMaster) return false
    cfg.aigc.enable = false
    return this.reply("AIGC已关闭", true)
  }

  async aigcOn() {
    if (!this.e.isMaster) return false
    cfg.aigc.enable = true
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
    logger.info(`[aigc] clear  uid=${this.e.user_id}`)
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
    if (this.e.isPrivate && cfg.aigc?.private_enable === false && !this.e.isMaster) return false

    // QQ 黑名单
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

    const userMsg = this.e.msg.trim()
    if (!userMsg) return

    const prefixFilter = cfg.aigc?.prefix_filter
    if (prefixFilter?.length) {
      for (const prefix of prefixFilter) {
        if (userMsg.startsWith(prefix)) return false
      }
    }

    const key = con().sessionKey(
      this.e.self_id,
      this.e.user_id,
      this.e.isGroup ? this.e.group_id : "",
    )
    const provider = cfg.aigc?.provider || "openai"
    const model = cfg.aigc?.[provider]?.model || "gpt-4o-mini"
    const gid = this.e.isGroup ? this.e.group_id : "-"

    logger.info(
      `[aigc] req  uid=${this.e.user_id}  gid=${gid}  model=${model}  len=${userMsg.length}`,
    )

    await con().setSystem(key, await this._buildSystem(userMsg))

    const images = this.e.img?.length ? this.e.img : null

    try {
      await this._replyLoop(key, userMsg, images)
    } catch (err) {
      logger.error(`[aigc] ${err.message}`)
      await this.reply("AIGC 服务暂时不可用，请稍后重试", true)
    }
  }

  async _buildSystem(userMsg) {
    const parts = [
      cfg.aigc?.system_prompt || "你是 AIGC-Yunzai，一个智能聊天机器人助手。",
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

      let ctx = `当前为群聊环境，群名称：${e.group_name || "未知"}，群号：${e.group_id}，你的群昵称：${botName}，你的QQ：${e.self_id}。当前发言用户：[${card}](qq:${e.user_id},性别:${sex},群身份:${role})。`

      const histCount = cfg.aigc?.group_history_count ?? 30
      if (histCount > 0) {
        const history = await this._getGroupHistory(histCount)
        if (history) {
          ctx += `\n最近群聊记录：\n${history}`
        }
      }

      return ctx
    }

    return `当前为私聊环境，当前用户昵称：${e.sender?.nickname || "未知"}，QQ：${e.user_id}。`
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
        const name = sender.card || sender.nickname || "未知"
        const qq = sender.user_id || "?"
        const sex = sender.sex || "unknown"
        const role = sender.role || "member"

        const text = this._extractMsgText(msg)
        if (!text) continue

        lines.push(`[${name}](qq:${qq},性别:${sex},群身份:${role}): ${text}`)
      }

      return lines.length ? lines.join("\n") : null
    } catch (err) {
      logger.warn(`[aigc] failed to get group history: ${err.message}`)
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
        logger.warn(
          `[aigc] blocked  uid=${this.e.user_id}  finishReason=${res.finishReason}`,
        )
        return this.reply("内容被安全策略拦截", true)
      }

      if (res.tool_calls?.length) {
        if (res.content) {
          logger.mark(
            `[aigc] tool-call-with-text  round=${round + 1}  text=${res.content.slice(0, 80)}`,
          )
          this.reply(res.content, true)
        }
        const names = res.tool_calls
          .map((c) => c.function?.name)
          .filter(Boolean)
          .join(",")
        logger.mark(`[aigc] tool-call  round=${round + 1}  tools=${names}`)

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
          await con().addMessage(
            sessionKey,
            "tool",
            JSON.stringify(r.error || r.result),
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

        const tokens = res.usage?.total_tokens
        logger.mark(
          `[aigc] reply  uid=${this.e.user_id}  rounds=${round + 1}${tokens ? `  tokens=${tokens}` : ""}  len=${res.content.length}`,
        )
        return this.reply(res.content, true)
      }

      // 空响应 (非 blocked) → 不存记忆，直接结束
      logger.warn(`[aigc] empty  round=${round + 1}`)
      return
    }

    // 工具调用轮数超限，强制获取文本回复 (不带 tools)
    logger.warn(`[aigc] max-rounds  uid=${this.e.user_id}  forcing text reply`)
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
      logger.mark(
        `[aigc] reply  uid=${this.e.user_id}  final=1  len=${finalReply.content.length}`,
      )
      return this.reply(finalReply.content, true)
    }

    logger.error(`[aigc] all-rounds-failed  uid=${this.e.user_id}`)
    return this.reply("处理超时，请稍后再试", true)
  }
}
