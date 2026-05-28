import fs from "node:fs"
import YAML from "yaml"
import log from "./helpers/log.js"

const FILE = "config/config/aigc.yaml"

function readDoc() {
  if (!fs.existsSync(FILE)) throw new Error(`配置文件不存在: ${FILE}`)
  return YAML.parseDocument(fs.readFileSync(FILE, "utf8"))
}

async function setEnable(value) {
  try {
    const doc = readDoc()
    doc.set("enable", !!value)
    fs.writeFileSync(FILE, String(doc), "utf8")
  } catch (err) {
    log.error(`设置 AIGC 开关失败: ${err.message}`)
  }
}

async function addBlacklist(qq) {
  try {
    const doc = readDoc()
    const s = String(qq)
    let seq = doc.get("qq_blacklist", true)
    if (!seq?.items) {
      seq = new YAML.YAMLSeq()
      doc.set("qq_blacklist", seq)
    }
    if (seq.items.some(it => String(it.value ?? it) === s)) return false
    seq.add(s)
    fs.writeFileSync(FILE, String(doc), "utf8")
    return true
  } catch (err) {
    log.error(`添加黑名单失败: ${err.message}`)
    return false
  }
}

async function removeBlacklist(qq) {
  try {
    const doc = readDoc()
    const s = String(qq)
    const seq = doc.get("qq_blacklist", true)
    if (!seq?.items) return false
    const idx = seq.items.findIndex(it => String(it.value ?? it) === s)
    if (idx < 0) return false
    seq.items.splice(idx, 1)
    fs.writeFileSync(FILE, String(doc), "utf8")
    return true
  } catch (err) {
    log.error(`移除黑名单失败: ${err.message}`)
    return false
  }
}

export default { setEnable, addBlacklist, removeBlacklist }
