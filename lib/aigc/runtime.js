import fs from "node:fs"
import YAML from "yaml"

const FILE = "config/config/aigc.yaml"

function readDoc() {
  return YAML.parseDocument(fs.readFileSync(FILE, "utf8"))
}

async function setEnable(value) {
  const doc = readDoc()
  doc.set("enable", !!value)
  fs.writeFileSync(FILE, String(doc), "utf8")
}

async function addBlacklist(qq) {
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
}

async function removeBlacklist(qq) {
  const doc = readDoc()
  const s = String(qq)
  const seq = doc.get("qq_blacklist", true)
  if (!seq?.items) return false
  const idx = seq.items.findIndex(it => String(it.value ?? it) === s)
  if (idx < 0) return false
  seq.items.splice(idx, 1)
  fs.writeFileSync(FILE, String(doc), "utf8")
  return true
}

export default { setEnable, addBlacklist, removeBlacklist }
