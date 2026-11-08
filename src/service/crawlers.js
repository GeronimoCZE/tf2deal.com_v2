// Search engine and AI crawlers skip the site's rate limits (app.js allRequestsLimiter and the item list / bot
// inventory limits in api/), so they can read every page as fast as they like.
//
// A crawler's name in the User-Agent is easy to fake, so a request only counts as a crawler when its address checks out
// too, the way each company says to check it:
//  - the address is in the company's published list of crawler addresses (Google, Bing, OpenAI, Anthropic, ...), or
//  - reverse DNS gives a host name of the company (crawl-66-249-66-1.googlebot.com) and that name resolves back to the
//    same address (both steps, or anyone could name their own server "googlebot.com").
// The lists are downloaded at start and once a day. DNS answers are kept for a day; while one is being looked up the
// request is simply counted like any other (one request more on a limit of 600 doesn't matter, and nobody waits).
//
// The check uses req.ip, so TRUST_PROXY has to match the proxies in front of the site (docs/UBUNTU.md): with a value
// too high, a visitor could send their own X-Forwarded-For with a Google address.

import net from 'net'
import dns from 'dns'
import fetch from 'node-fetch'
import { LRUCache } from 'lru-cache'

// name: shown in the log. ua: the User-Agent words of the company's crawlers. lists: published address lists (JSON
// with "prefixes": [{ipv4Prefix|ipv6Prefix}] for most; any IP or CIDR in the file is read). dns: host name endings.
export const CRAWLERS = [
  {
    name: 'Google',
    ua: /Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google|AdsBot-Google|Mediapartners-Google|APIs-Google|FeedFetcher-Google|Google-Read-Aloud|Google-Site-Verification|Google-CloudVertexBot|GoogleAgent/i,
    lists: [
      'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
      'https://developers.google.com/static/crawling/ipranges/special-crawlers.json',
      'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json',
      'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json',
      'https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json'
    ],
    // not googleusercontent.com: every Google Cloud server has a name there (the user-triggered fetchers are in the lists)
    dns: ['googlebot.com', 'google.com']
  },
  { name: 'Bing', ua: /bingbot|BingPreview|msnbot|adidxbot|MicrosoftPreview/i, lists: ['https://www.bing.com/toolbox/bingbot.json'], dns: ['search.msn.com'] },
  { name: 'DuckDuckGo', ua: /DuckDuckBot|DuckAssistBot/i, lists: ['https://duckduckgo.com/duckduckbot.json'], dns: [] },
  { name: 'Yandex', ua: /Yandex(?:Bot|Images|Mobile|Render|Metrika|Accessibility|Additional|Favicons|Video|Blogs|Webmaster|Market|News)/i, lists: [], dns: ['yandex.ru', 'yandex.net', 'yandex.com'] },
  { name: 'Baidu', ua: /Baiduspider/i, lists: [], dns: ['baidu.com', 'baidu.jp'] },
  { name: 'Seznam', ua: /SeznamBot/i, lists: ['https://search.seznam.cz/ipranges/seznambot.json'], dns: ['seznam.cz'] },
  { name: 'Apple', ua: /Applebot/i, lists: ['https://search.developer.apple.com/applebot.json'], dns: ['applebot.apple.com'] },
  {
    name: 'OpenAI',
    ua: /GPTBot|OAI-SearchBot|ChatGPT-User|OAI-AdsBot/i,
    lists: ['https://openai.com/gptbot.json', 'https://openai.com/searchbot.json', 'https://openai.com/chatgpt-user.json', 'https://openai.com/adsbot.json'],
    dns: []
  },
  { name: 'Anthropic', ua: /ClaudeBot|Claude-User|Claude-SearchBot|Claude-Agent/i, lists: ['https://claude.com/crawling/bots.json'], dns: [] },
  {
    name: 'Perplexity',
    ua: /PerplexityBot|Perplexity-User/i,
    lists: ['https://www.perplexity.com/perplexitybot.json', 'https://www.perplexity.com/perplexity-user.json'],
    dns: []
  },
  { name: 'Common Crawl', ua: /CCBot/i, lists: ['https://index.commoncrawl.org/ccbot.json'], dns: ['crawl.commoncrawl.org'] },
  { name: 'Amazon', ua: /Amazonbot/i, lists: ['https://developer.amazon.com/amazonbot/ip-addresses/'], dns: [] }
]

const LIST_EVERY = 24 * 60 * 60 * 1000 // lists again once a day
const LIST_RETRY = 60 * 60 * 1000 // a list that failed: again in an hour (the last good copy stays in use)
const DNS_TIMEOUT = 3000
const MAX_LOOKUPS = 20 // DNS checks at the same time; more requests wait for a later one

// Addresses that are never a crawler: the server itself and private networks. With TRUST_PROXY missing every visitor
// shows up as 127.0.0.1 (Nginx), and a list with such a range by mistake must not open the limits for everyone.
const PRIVATE = new net.BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) {
  PRIVATE.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]]) PRIVATE.addSubnet(address, prefix, 'ipv6')

// "::ffff:66.249.66.1" (an IPv4 visitor on an IPv6 socket) -> "66.249.66.1"; '' for anything that is no address
export const clean_ip = (ip) => {
  const value = String(ip || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
  return net.isIP(value) ? value : ''
}
const family = (ip) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4')
const is_private = (ip) => PRIVATE.check(ip, family(ip))

// every address range in a downloaded list: the JSON lists hold them as strings ("66.249.64.0/27"), Amazon's page has
// them inside HTML, so a file that isn't JSON is searched for IPv4 addresses
export const parse_list = (text) => {
  const found = []
  const add = (value) => {
    const [address, bits] = String(value).trim().split('/')
    const ip = clean_ip(address)
    if (!ip || (bits !== undefined && !/^\d{1,3}$/.test(bits))) return
    const max = net.isIPv6(ip) ? 128 : 32
    const prefix = bits === undefined ? max : Number(bits)
    // a range wider than /8 (IPv4) or /16 (IPv6) is a broken list, not a crawler
    if (prefix > max || prefix < (max === 32 ? 8 : 16) || is_private(ip)) return
    found.push([ip, prefix])
  }
  let json
  try { json = JSON.parse(text) } catch { json = undefined }
  if (json !== undefined) {
    const walk = (value) => {
      if (typeof value === 'string') add(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(json)
  } else {
    for (const match of String(text).matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(\/\d{1,2})?(?![\d.])/g)) add(match[0])
  }
  return found
}

// the downloaded lists: url -> { ranges: [[ip, prefix]], at, error }, and one BlockList per crawler built from them
const lists = new Map()
let blocks = new Map() // crawler name -> net.BlockList
let list_timer = null

const build_blocks = () => {
  const next = new Map()
  for (const crawler of CRAWLERS) {
    const block = new net.BlockList()
    for (const url of crawler.lists) {
      for (const [ip, prefix] of lists.get(url)?.ranges || []) block.addSubnet(ip, prefix, family(ip))
    }
    next.set(crawler.name, block)
  }
  blocks = next
}

const download = async (url) => {
  const res = await fetch(url, { timeout: 20000, size: 10e6, headers: { 'user-agent': 'tf2deal.com crawler address check', accept: 'application/json, */*' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ranges = parse_list(await res.text())
  if (!ranges.length) throw new Error('no addresses in it')
  return ranges
}

// downloads every list that is due; a list that fails keeps its last good copy
export const refresh_lists = async () => {
  const now = Date.now()
  const urls = [...new Set(CRAWLERS.flatMap((c) => c.lists))]
  const due = urls.filter((url) => {
    const entry = lists.get(url)
    return !entry || now - entry.at >= (entry.error ? LIST_RETRY : LIST_EVERY)
  })
  if (!due.length) return
  await Promise.all(due.map(async (url) => {
    try {
      lists.set(url, { ranges: await download(url), at: Date.now(), error: null })
    } catch (error) {
      const old = lists.get(url)
      lists.set(url, { ranges: old?.ranges || [], at: Date.now(), error: error.message || String(error) })
    }
  }))
  build_blocks()
  const failed = urls.filter((url) => lists.get(url)?.error)
  const ranges = urls.reduce((sum, url) => sum + (lists.get(url)?.ranges.length || 0), 0)
  const line = `Crawlers: address lists read: ${urls.length - failed.length} of ${urls.length}` +
    (failed.length ? `; not read: ${failed.map((url) => `${url} (${lists.get(url).error})`).join(', ')}` : '')
  if (line !== last_line) console.log(`${line} (${ranges} address ranges)`) // a list that keeps failing is logged once
  last_line = line
}
let last_line = ''

// reverse DNS, then the name has to end in one of the company's domains and resolve back to the same address
const with_timeout = (promise) => Promise.race([
  promise,
  new Promise((resolve, reject) => setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT).unref())
])
export const dns_check = async (ip, domains) => {
  const names = await with_timeout(dns.promises.reverse(ip))
  const type = family(ip)
  const same = new net.BlockList()
  same.addAddress(ip, type)
  for (const name of names) {
    const host = String(name).toLowerCase().replace(/\.$/, '')
    if (!domains.some((domain) => host.endsWith('.' + domain))) continue
    const addresses = await with_timeout(type === 'ipv6' ? dns.promises.resolve6(host) : dns.promises.resolve4(host)).catch(() => [])
    if (addresses.some((address) => same.check(address, type))) return true
  }
  return false
}

// DNS answers: "<crawler>|<ip>" -> true/false for a day (a lookup that failed: 10 minutes)
const dns_cache = new LRUCache({ max: 20000, ttl: 24 * 60 * 60 * 1000 })
const pending = new Set()
const seen = new Map() // crawler name -> requests let through since start (log and Admin)

const start_dns_check = (crawler, ip) => {
  const key = `${crawler.name}|${ip}`
  if (pending.has(key) || pending.size >= MAX_LOOKUPS) return
  pending.add(key)
  dns_check(ip, crawler.dns)
    .then((ok) => dns_cache.set(key, ok))
    .catch(() => dns_cache.set(key, false, { ttl: 10 * 60 * 1000 }))
    .finally(() => pending.delete(key))
}

// the crawler a request comes from ('Google', 'OpenAI', ...) or null. Never waits: an address not checked yet is
// looked up in the background and counts as a normal visitor until the answer is there.
export const crawler_of = (req) => {
  const user_agent = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '')
  if (!user_agent) return null
  const crawler = CRAWLERS.find((c) => c.ua.test(user_agent))
  if (!crawler) return null
  const ip = clean_ip(req.ip)
  if (!ip || is_private(ip)) return null
  let ok = blocks.get(crawler.name)?.check(ip, family(ip)) || false
  if (!ok && crawler.dns.length) {
    const cached = dns_cache.get(`${crawler.name}|${ip}`)
    if (cached === undefined) start_dns_check(crawler, ip)
    ok = cached === true
  }
  if (!ok) return null
  const count = (seen.get(crawler.name) || 0) + 1
  seen.set(crawler.name, count)
  if (count === 1) console.log(`Crawlers: ${crawler.name} checked (${ip}), it skips the rate limits`)
  return crawler.name
}

// express-rate-limit's skip option: true for a checked crawler
export const skip = (req) => {
  if (req.crawler === undefined) req.crawler = crawler_of(req)
  return req.crawler !== null
}

// marks req.crawler once per request, before the limits run
export const middleware = (req, res, next) => {
  if (req.crawler === undefined) req.crawler = crawler_of(req)
  next()
}

// for Admin → Overview: requests let through per crawler since start (most first), and how many lists were read
export const status = () => {
  const urls = [...new Set(CRAWLERS.flatMap((c) => c.lists))]
  return {
    requests: [...seen].sort((a, b) => b[1] - a[1]),
    lists_read: urls.filter((url) => lists.get(url)?.ranges.length).length,
    lists_total: urls.length,
    failed: urls.filter((url) => lists.get(url)?.error)
  }
}

export const start = () => {
  if (list_timer) return
  refresh_lists().catch((error) => console.log('Crawlers: lists not read:', error.message || error))
  list_timer = setInterval(() => refresh_lists().catch(() => {}), LIST_RETRY)
  list_timer.unref()
}
