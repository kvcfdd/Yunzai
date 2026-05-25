import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import { execFile, exec } from 'child_process'
import util from 'util'

const execAsync = util.promisify(exec)
const execFileAsync = util.promisify(execFile)

const downloaderConfig = {
  aria2cConcurrency: 8
}

const toolCheckCache = {}
export async function isToolInstalled (toolName) {
  if (toolCheckCache[toolName] !== undefined) {
    return toolCheckCache[toolName]
  }
  try {
    await execAsync(`${toolName} --version`)
    logger.info(`bilibili 检测到工具  ${toolName}`)
    toolCheckCache[toolName] = true
    return true
  } catch (error) {
    logger.warn(`bilibili 未找到工具  ${toolName}`) 
    toolCheckCache[toolName] = false
    return false
  }
}

export async function mergeVideoAndAudio (videoPath, audioPath, outputPath) {
  logger.info(`bilibili FFmpeg`)
  try {
    const cmd = 'ffmpeg'
    const args = ['-y', '-i', videoPath, '-i', audioPath, '-c', 'copy', outputPath]
    await execFileAsync(cmd, args)
  } catch (err) {
    logger.error(`bilibili FFmpeg失败: ${err.stderr || err.message}`)
    if (err.code === 'ENOENT') {
      throw new Error('FFmpeg not found. Please ensure FFmpeg is installed and accessible in your system\'s PATH.')
    }
    throw new Error(`FFmpeg failed to merge files: ${err.stderr || err.message}`)
  }
}

export async function downloadWithAria2c (videoUrl, audioUrl, videoPath, audioPath, headers) {
  logger.info(`bilibili 下载  aria2c`)
  const concurrency = downloaderConfig.aria2cConcurrency.toString()

  const baseArgs = ['-x', concurrency, '-s', concurrency, '--allow-overwrite=true']
  for (const [key, value] of Object.entries(headers)) {
    baseArgs.push(`--header=${key}: ${value}`)
  }

  const videoArgs = [...baseArgs, '-o', path.basename(videoPath), '-d', path.dirname(videoPath), videoUrl]
  const audioArgs = [...baseArgs, '-o', path.basename(audioPath), '-d', path.dirname(audioPath), audioUrl]

  await Promise.all([
    execFileAsync('aria2c', videoArgs),
    execFileAsync('aria2c', audioArgs)
  ])

  logger.info(`bilibili 下载完成  aria2c`)
}

export async function downloadWithNativeFetch (videoUrl, audioUrl, videoPath, audioPath, headers) {
  logger.info(`bilibili 下载  fetch`)

  const downloadStream = async (url, filePath) => {
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`)
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath)
      response.body.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  }

  await Promise.all([
    downloadStream(videoUrl, videoPath),
    downloadStream(audioUrl, audioPath)
  ])
  logger.info(`bilibili 下载完成  fetch`)
}

export async function getBilibili (bvid) {
  try {
    const biliRes = await fetch('https://www.bilibili.com')
    const setCookieHeaders = biliRes.headers.getSetCookie()
    if (!setCookieHeaders) { throw new Error('Failed to get initial cookies from bilibili.com') }
    const cookieHeader = setCookieHeaders.map(header => header.split(';')[0]).join('; ')
    const apiHeaders = { 'Referer': 'https://www.bilibili.com', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36', 'Cookie': cookieHeader }

    const videoInfoRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: apiHeaders })
    if (!videoInfoRes.ok) throw new Error(`Bilibili view API request failed with status ${videoInfoRes.status}`)
    const videoInfo = await videoInfoRes.json()
    if (videoInfo.code !== 0) throw new Error(`Bilibili view API error: ${videoInfo.message}`)
    const { cid, aid, title, pic, desc, owner, stat, pubdate, honor_reply } = videoInfo.data

    const downloadInfoRes = await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16`, { headers: apiHeaders })
    if (!downloadInfoRes.ok) throw new Error(`Bilibili playurl API request failed with status ${downloadInfoRes.status}`)
    const downloadInfo = await downloadInfoRes.json()
    if (downloadInfo.code !== 0) throw new Error(`Bilibili playurl API error: ${downloadInfo.message}`)

    const videoStream = downloadInfo.data?.dash?.video?.[0]
    const audioStream = downloadInfo.data?.dash?.audio?.[0]

    // 获取流的体积大小
    let totalSize = 0
    try {
      if (videoStream?.baseUrl) {
        const vRes = await fetch(videoStream.baseUrl, { method: 'HEAD', headers: apiHeaders })
        totalSize += parseInt(vRes.headers.get('content-length'), 10) || 0
      }
      if (audioStream?.baseUrl) {
        const aRes = await fetch(audioStream.baseUrl, { method: 'HEAD', headers: apiHeaders })
        totalSize += parseInt(aRes.headers.get('content-length'), 10) || 0
      }
    } catch (err) {
      logger.warn(`bilibili 获取大小失败: ${err.message}`)
    }

    return {
      arcurl: `https://www.bilibili.com/video/av${aid}`,
      title,
      pic,
      description: desc,
      videoUrl: videoStream?.baseUrl,
      audioUrl: audioStream?.baseUrl,
      headers: apiHeaders,
      bvid,
      author: owner.name,
      play: stat.view,
      pubdate,
      like: stat.like,
      honor: honor_reply?.honor?.map(h => h.desc)?.join('、'),
      totalSize
    }
  } catch (err) {
    logger.error(`bilibili 获取失败: ${err.message}`)
    return null
  }
}
