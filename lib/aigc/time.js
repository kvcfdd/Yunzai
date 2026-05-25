/**
 * 时间格式化工具模块
 */

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

const PERIODS = [
  [0, 6, "凌晨"],
  [6, 9, "早晨"],
  [9, 11, "上午"],
  [11, 13, "中午"],
  [13, 17, "下午"],
  [17, 19, "傍晚"],
  [19, 23, "晚上"],
  [23, 24, "深夜"],
]

/**
 * 格式化 Date 为可读字符串。
 * @param {Date} d
 * @param {"compact"|"full"} style
 *   "compact" → YYYY-MM-DD HH:MM:SS
 *   "full"    → YYYY年M月D日 周X 时段 H:MM
 */
export function formatDate(d, style = "compact") {
  const pad = n => String(n).padStart(2, "0")
  const y = d.getFullYear()
  const mo = d.getMonth() + 1
  const day = d.getDate()
  const h = d.getHours()
  const mi = pad(d.getMinutes())

  if (style === "compact") {
    const s = pad(d.getSeconds())
    return `${y}-${pad(mo)}-${pad(day)} ${pad(h)}:${mi}:${s}`
  }

  const weekday = WEEKDAYS[d.getDay()]
  const period = PERIODS.find(([lo, hi]) => h >= lo && h < hi)?.[2] || "深夜"
  return `${y}年${mo}月${day}日 ${weekday} ${period} ${h}:${mi}`
}

/**
 * 获取指定时区的当前时间 Date 对象。
 * @param {string} tz IANA 时区名，默认 Asia/Shanghai
 * @returns {Date}
 */
export function nowInTz(tz = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date())

  const get = type => parts.find(p => p.type === type)?.value || "00"
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  )
}
