import tools from "./registry.js"
import { getBilibili, isToolInstalled, downloadWithAria2c, downloadWithNativeFetch, mergeVideoAndAudio } from "../helpers/bilibili.js"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import fetch from "node-fetch"
import { pipeline } from "node:stream/promises"
import { formatDate } from "../helpers/time.js"
import log from "../helpers/log.js"

function mkdirs(dirname) {
  if (fs.existsSync(dirname)) return true
  if (mkdirs(path.dirname(dirname))) {
    fs.mkdirSync(dirname)
    return true
  }
}

/** 下载封面图到本地，解决 QQ 官方 Bot 不支持远程 URL 的问题 */
async function downloadCover(url) {
  const coverDir = path.join(process.cwd(), "data", "aigc", "covers")
  await fsp.mkdir(coverDir, { recursive: true }).catch(() => { })
  const filePath = path.join(coverDir, `cover_${crypto.randomUUID()}.jpg`)
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    await pipeline(res.body, fs.createWriteStream(filePath))
    return filePath
  } catch {
    return null
  }
}

tools.register({
  name: "send_media",
  description: "Send a music card (Netease) or video (Bilibili) to the chat. type='music' needs a Netease song ID, type='video' needs a Bilibili BVID.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["music", "video"], description: "Media type — music or video only, NOT image" },
      id: { type: "string", description: "Music ID (Netease) or video BVID (Bilibili) from search results" },
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
        log.error(`发送音乐失败: ${err.message}`)
        return `Send music failed: ${err.message}`
      }
    }

    if (type === "video") {
      const tempDir = path.resolve("data/aigc/videos/temp", id)
      mkdirs(tempDir)
      const videoPath = path.join(tempDir, "video.m4s")
      const audioPath = path.join(tempDir, "audio.m4s")
      const outputPath = path.resolve(`data/aigc/videos/${id}.mp4`)

      try {
        const meta = await getBilibili(id)
        if (!meta) return `Failed to get video info for BVID: ${id}`

        const { arcurl, title, pic, description, videoUrl, audioUrl, headers, author, play, pubdate, like, honor, totalSize } = meta

        if (!videoUrl || !audioUrl) {
          return `Cannot get video stream for BVID: ${id}. Video may be members-only, paid, or has no audio track.`
        }

        const isOversize = totalSize > 52428800

        // 下载封面图到本地（部分适配器不支持远程 URL）
        const coverPath = await downloadCover(pic)
        const imageMsg = coverPath
          ? { type: "image", data: { file: coverPath } }
          : { type: "text", data: { text: `[封面: ${pic}]` } }

        await e.reply([
          { type: "text", data: { text: `标题：${title.replace(/<[^>]+>/g, "")}\n` } },
          { type: "text", data: { text: `UP主：${author}\n发布：${formatDate(new Date(pubdate * 1000), "compact")}\n播放：${play}  点赞：${like}\n` } },
          { type: "text", data: { text: `链接：${arcurl}` } },
          imageMsg,
          { type: "text", data: { text: isOversize ? "\n视频过大，请点击链接前往观看" : "\n正在准备视频，请稍候..." } },
        ])

        if (isOversize) {
          log.debug(`视频过大，跳过下载: ${id}`)
          return `Video info sent, but file exceeds 50MB. Link provided to user.`
        }

        if (await isToolInstalled("aria2c")) {
          await downloadWithAria2c(videoUrl, audioUrl, videoPath, audioPath, headers)
        } else {
          await downloadWithNativeFetch(videoUrl, audioUrl, videoPath, audioPath, headers)
        }

        await mergeVideoAndAudio(videoPath, audioPath, outputPath)
        log.debug(`视频合并完成: ${id}`)

        await e.reply({ type: "video", data: { file: outputPath } })
        return `Video sent`
      } catch (err) {
        log.error(`发送视频失败: ${err.message}`)
        return `Send video failed: ${err.message}`
      }
    }

    return "Unknown media type"
  },
})
