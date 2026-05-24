import tools from "./registry.js"
import { getBilibili, isToolInstalled, downloadWithAria2c, downloadWithNativeFetch, mergeVideoAndAudio } from "../blibli/bilibili.js"
import fs from "node:fs"
import path from "node:path"

function formatDate(date) {
  const weekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hour = date.getHours()
  const minute = String(date.getMinutes()).padStart(2, "0")
  const weekday = weekDays[date.getDay()]
  let period = ""
  if (hour >= 0 && hour < 6) period = "early morning"
  else if (hour >= 6 && hour < 9) period = "morning"
  else if (hour >= 9 && hour < 11) period = "late morning"
  else if (hour >= 11 && hour < 13) period = "noon"
  else if (hour >= 13 && hour < 17) period = "afternoon"
  else if (hour >= 17 && hour < 19) period = "evening"
  else if (hour >= 19 && hour < 23) period = "night"
  else period = "late night"
  return `${year}-${month}-${day} ${weekday} ${period} ${hour}:${minute}`
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
  description: "Send a music card or video. Use the search tool first to get the ID.",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["music", "video"],
        description: "Media type",
      },
      id: {
        type: "string",
        description: "Music ID (Netease) or video BVID (Bilibili)",
      },
    },
    required: ["type", "id"],
  },
  execute: async (args, ctx) => {
    const e = ctx?.event
    if (!e) return "Cannot get context"

    const { type, id } = args

    if (type === "music") {
      try {
        await e.reply({ type: "music", data: { type: "163", id: String(id) } })
        return "Music card sent"
      } catch (err) {
        logger.error(`[aigc] send_media music err=${err.message}`)
        return `Send music failed: ${err.message}`
      }
    }

    if (type === "video") {
      const tempDir = path.resolve("data/aigc/videos/temp", id)
      mkdirs(tempDir)
      const videoPath = path.join(tempDir, "video.m4s")
      const audioPath = path.join(tempDir, "audio.m4s")
      const outputPath = path.resolve(`data/aigc/videos/${id}.mp4`)

      const cleanup = () => {
        fs.rm(tempDir, { recursive: true, force: true }, () => { })
        fs.unlink(outputPath, () => { })
      }

      try {
        const meta = await getBilibili(id)
        if (!meta) return `Failed to get video info for BVID: ${id}`

        const { arcurl, title, pic, description, videoUrl, audioUrl, headers, author, play, pubdate, like, honor, totalSize } = meta

        if (!videoUrl || !audioUrl) {
          return `Cannot get video stream for BVID: ${id}. Video may be members-only, paid, or has no audio track.`
        }

        const infoText = [
          `Title: ${title.replace(/(<([^>]+)>)/ig, "")}`,
          `Uploader: ${author}`,
          `Published: ${formatDate(new Date(pubdate * 1000))}`,
          `Plays: ${play}  Likes: ${like}`,
          `URL: ${arcurl}`,
          honor ? `Honors: ${honor}` : null,
          `Description: ${description}`,
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
          return `Video info sent, but file exceeds 50MB. Link provided to user. Video summary:\n${infoText}`
        }

        if (await isToolInstalled("aria2c")) {
          await downloadWithAria2c(videoUrl, audioUrl, videoPath, audioPath, headers)
        } else {
          await downloadWithNativeFetch(videoUrl, audioUrl, videoPath, audioPath, headers)
        }

        await mergeVideoAndAudio(videoPath, audioPath, outputPath)
        logger.info(`[aigc] send_media merged  bvid=${id}  output=${outputPath}`)

        await e.reply({ type: "video", data: { file: `file://${outputPath}` } })
        return `Video sent. Summary for your reference:\n${infoText}`
      } catch (err) {
        logger.error(`[aigc] send_media video err=${err.message}`)
        cleanup()
        return `Send video failed: ${err.message}`
      } finally {
        setTimeout(cleanup, 10000)
      }
    }

    return "Unknown media type"
  },
})
