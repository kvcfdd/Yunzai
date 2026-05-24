import tools from "./registry.js"
import { getBilibili, isToolInstalled, downloadWithAria2c, downloadWithNativeFetch, mergeVideoAndAudio } from "../blibli/bilibili.js"
import fs from "node:fs"
import path from "node:path"

function formatDate(date) {
  const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hour = date.getHours()
  const minute = String(date.getMinutes()).padStart(2, "0")
  const weekday = weekDays[date.getDay()]
  let period = ""
  if (hour >= 0 && hour < 6) period = "凌晨"
  else if (hour >= 6 && hour < 9) period = "早上"
  else if (hour >= 9 && hour < 11) period = "上午"
  else if (hour >= 11 && hour < 13) period = "中午"
  else if (hour >= 13 && hour < 17) period = "下午"
  else if (hour >= 17 && hour < 19) period = "傍晚"
  else if (hour >= 19 && hour < 23) period = "晚上"
  else period = "深夜"
  return `${year}年${month}月${day}日 ${weekday} ${period}${hour}:${minute}`
}

function mkdirs(dirname) {
  if (fs.existsSync(dirname)) return true
  if (mkdirs(path.dirname(dirname))) {
    fs.mkdirSync(dirname)
    return true
  }
}

tools.register({
  name: "send_media",
  description: "发送音乐卡片或视频。先通过 search 工具搜索获取 ID，再选择一条结果调用此工具发送。音乐用网易云 ID，视频用 Bilibili BVID。",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["music", "video"],
        description: "媒体类型",
      },
      id: {
        type: "string",
        description: "音乐 ID（网易云）或视频 BVID（Bilibili）",
      },
    },
    required: ["type", "id"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "无法获取上下文"

    const { type, id } = args

    if (type === "music") {
      try {
        await e.reply({ type: "music", data: { type: "163", id: String(id) } })
        return "已发送音乐卡片"
      } catch (err) {
        logger.error(`[aigc] send_media music err=${err.message}`)
        return `发送音乐失败: ${err.message}`
      }
    }

    if (type === "video") {
      const tempDir = path.resolve("data/aigc/videos/temp", id)
      mkdirs(tempDir)
      const videoPath = path.join(tempDir, "video.m4s")
      const audioPath = path.join(tempDir, "audio.m4s")
      const outputPath = path.resolve(`data/aigc/videos/${id}.mp4`)

      const cleanup = () => {
        fs.rm(tempDir, { recursive: true, force: true }, () => {})
        fs.unlink(outputPath, () => {})
      }

      try {
        const meta = await getBilibili(id)
        if (!meta) return `获取视频信息失败，BVID: ${id}`

        const { arcurl, title, pic, description, videoUrl, audioUrl, headers, author, play, pubdate, like, honor, totalSize } = meta

        if (!videoUrl || !audioUrl) {
          return `无法获取视频流，BVID: ${id}。视频可能是仅会员、付费或无音频。`
        }

        const infoText = [
          `标题: ${title.replace(/(<([^>]+)>)/ig, "")}`,
          `UP主: ${author}`,
          `发布时间: ${formatDate(new Date(pubdate * 1000))}`,
          `播放: ${play}  点赞: ${like}`,
          `链接: ${arcurl}`,
          honor ? `荣誉: ${honor}` : null,
          `简介: ${description}`,
        ].filter(Boolean).join("\n")

        const isOversize = totalSize > 52428800

        await e.reply([
          { type: "text", data: { text: `标题：${title.replace(/(<([^>]+)>)/ig, "")}\n` } },
          { type: "text", data: { text: `UP主：${author}\n发布：${formatDate(new Date(pubdate * 1000))}\n播放：${play}  点赞：${like}\n` } },
          { type: "text", data: { text: `链接：${arcurl}` } },
          { type: "image", data: { file: pic } },
          { type: "text", data: { text: isOversize ? "\n视频过大，请点击链接前往观看" : "\n正在准备视频，请稍候..." } },
        ])

        if (isOversize) {
          logger.info(`[aigc] send_media oversize  bvid=${id}  size=${(totalSize / 1024 / 1024).toFixed(2)}MB`)
          return `视频信息已发送，但视频文件超过 50MB，已提供链接给用户。视频摘要：\n${infoText}`
        }

        if (await isToolInstalled("aria2c")) {
          await downloadWithAria2c(videoUrl, audioUrl, videoPath, audioPath, headers)
        } else {
          await downloadWithNativeFetch(videoUrl, audioUrl, videoPath, audioPath, headers)
        }

        await mergeVideoAndAudio(videoPath, audioPath, outputPath)
        logger.info(`[aigc] send_media merged  bvid=${id}  output=${outputPath}`)

        await e.reply({ type: "video", data: { file: `file://${outputPath}` } })
        return `已发送视频。视频摘要供你回复参考：\n${infoText}`
      } catch (err) {
        logger.error(`[aigc] send_media video err=${err.message}`)
        cleanup()
        return `发送视频失败: ${err.message}`
      } finally {
        setTimeout(cleanup, 10000)
      }
    }

    return "未知媒体类型"
  },
})
