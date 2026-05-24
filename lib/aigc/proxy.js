import { ProxyAgent } from "undici"
import cfg from "../config/config.js"

function _getAddress() {
  return cfg.aigc?.proxy?.address || ""
}

/**
 * LLM 请求用 — 受 enable 开关控制
 */
export function getLLMDispatcher() {
  const address = _getAddress()
  if (!address || !cfg.aigc?.proxy?.enable) return undefined
  return new ProxyAgent(address)
}

/**
 * 下载请求用 — 有代理地址就走，不受开关控制
 */
export function getDownloadDispatcher() {
  const address = _getAddress()
  if (!address) return undefined
  return new ProxyAgent(address)
}

/**
 * 网页访问用 (Playwright) — 传参决定，有地址才给
 */
export function getPlaywrightProxy(useProxy) {
  const address = _getAddress()
  if (!address || !useProxy) return undefined
  return { server: address }
}
