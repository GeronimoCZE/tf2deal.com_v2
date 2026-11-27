// The chat helper's firewall (service/assistant.js): what goes into the model and what comes out of it.
//
// The real wall is what the helper can reach: a short list of tools that read public data only (service/
// assistant_tools.js), the signed-in user taken from the server's session and never from the model, conversations
// kept on the server so a page can't make up earlier turns, and no admin or account functions at all. This file adds
// the checks around it:
//
//   message(value)     the visitor's text: plain text only, no control or invisible characters, at most MAX_MESSAGE
//   suspicious(text)   attempts to talk the helper out of its rules ("ignore your instructions", "show the system
//                      prompt", "admin password"): counted for the admin panel. They get the same answer as anyone,
//                      because the model has nothing to give away, so nothing is refused on a guess.
//   reply(text)        the model's answer before it leaves the server: secrets are cut out (every secret in .env,
//                      API keys, database addresses, trade offer tokens), links go only to the site and its own
//                      community pages, and the length is capped. The whole answer is checked before it's sent:
//                      answers aren't streamed, so nothing reaches the browser unchecked.
//   safe_link(url)     the same link rule (the browser checks it again before it draws a link)

export const MAX_MESSAGE = 600
export const MAX_REPLY = 2500

// control characters (not tab or new line), zero-width and direction marks, which can hide text from a reader
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g

// Returns { text } or { error: 'not_text' | 'empty' | 'too_long' }
export const message = (value) => {
  if (typeof value != 'string') return { error: 'not_text' }
  const text = value.normalize('NFKC').replace(HIDDEN, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return { error: 'empty' }
  if (text.length > MAX_MESSAGE) return { error: 'too_long' }
  return { text }
}

const SUSPICIOUS = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|prompt|guidelines|above|previous)\b/i,
  /\b(system|developer|hidden|initial)\s*(prompt|message|instructions?)\b/i,
  /\b(you are now|act as|pretend to be|jailbreak|dan mode|developer mode|god mode)\b/i,
  /\b(api[\s_-]*key|secret|password|passwd|token|\.env|session[\s_-]*secret|private key|credentials?)\b/i,
  /\b(admin|administrator|root)\b.{0,30}\b(panel|access|rights?|mode|login|password|functions?|commands?)\b/i,
  /\b(database|mongo(db)?|sql|redis)\b.{0,30}\b(dump|query|connection|password|access|users?)\b/i,
  /\b(other|another|all)\s+(users?|people|players?|accounts?)['’]?s?\b.{0,40}\b(trades?|inventor(y|ies)|data|steam ?ids?|emails?|trade (urls?|links?))\b/i,
  /<\/?(system|assistant|tool|instructions?)>|\[\/?(system|inst)\]/i
]

export const suspicious = (text) => SUSPICIOUS.some((re) => re.test(String(text || '')))

/* ========================= SECRETS ========================= */

// .env values that must never show up in an answer: every setting whose name says it's a secret or an address of
// the site's own servers. Values that are public anyway stay out of the list (the site's address is in every link).
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASS|PASSWORD|PWD|CONNECTION|ENDPOINT|COOKIE|PRIVATE|SHARED|CREDENTIAL|AUTH|DSN|_URI$|DB_|MONGO|REDIS|ACCOUNT|STEAMID)/i
const PUBLIC_NAMES = new Set(['SITE_URL', 'PORT', 'TRUST_PROXY', 'NODE_ENV', 'STEAM_GROUP_ID', 'TRANSLATE_PROVIDER', 'TRANSLATE_MODEL'])
let secret_list = { at: 0, values: [] }
const extra_secrets = new Set() // added at run time (the chat helper's API key saved in the admin panel)

export const add_secret = (value) => { if (typeof value == 'string' && value.length >= 8) extra_secrets.add(value) }
export const drop_secret = (value) => { extra_secrets.delete(value) }

const secrets = () => {
  if (Date.now() - secret_list.at > 5 * 60 * 1000) {
    const values = Object.entries(process.env)
      .filter(([name, value]) => SECRET_NAME.test(name) && !PUBLIC_NAMES.has(name) && typeof value == 'string' && value.trim().length >= 8)
      .map(([, value]) => value.trim())
      .filter((value) => !String(process.env.SITE_URL || '').startsWith(value)) // never the site's own address
    // longest first, so a secret that contains another one is cut out whole
    secret_list = { at: Date.now(), values: [...new Set(values)].sort((a, b) => b.length - a.length) }
  }
  return [...secret_list.values, ...extra_secrets]
}

// secrets by their shape, whatever their name
const SECRET_SHAPES = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,                                   // Anthropic API keys
  /\b(?:mongodb(?:\+srv)?|redis|rediss|postgres(?:ql)?|mysql|amqp):\/\/\S+/gi, // database and queue addresses
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/tradeoffer\/new\/?\?partner=\d+(?:&|&amp;)token=[\w-]+/gi, // a trade URL (its token lets anyone send offers)
  /\b(?:ghp|gho|github_pat|xox[abpr])_[A-Za-z0-9_]{16,}/g,       // GitHub / Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g                                        // AWS access keys
]

/* ========================= LINKS ========================= */

// where an answer may link: the site itself (a path like /items/Team%20Captain, or its own address) and the site's
// community pages listed in llms.txt, plus backpack.tf and the TF2 Wiki for prices and item facts
const LINK_HOSTS = [
  { host: 'steamcommunity.com', path: /^\/groups\/tradetf2deal(\/|$)/i },
  { host: 'discord.gg', path: /^\/br3WvWaW5y\/?$/ },
  { host: 'reddit.com', path: /^\/r\/tf2deal(\/|$)/i },
  { host: 'www.reddit.com', path: /^\/r\/tf2deal(\/|$)/i },
  { host: 'www.trustpilot.com', path: /^\/review\/tf2deal\.com/i },
  { host: 'backpack.tf', path: /^\// },
  { host: 'wiki.teamfortress.com', path: /^\// }
]
const site_host = () => {
  try { return new URL(process.env.SITE_URL || 'https://tf2deal.com').host.toLowerCase() } catch (e) { return 'tf2deal.com' }
}

// true for a link an answer may carry
export const safe_link = (url) => {
  const value = String(url || '').trim()
  if (/^\/(?![\/\\])[^\s<>"'`]*$/.test(value)) return true // a path on the site
  let parsed
  try { parsed = new URL(value) } catch (e) { return false }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false
  const host = parsed.host.toLowerCase()
  if (host === site_host() || host === 'tf2deal.com' || host === 'www.tf2deal.com') return true
  return LINK_HOSTS.some((rule) => rule.host === host && rule.path.test(parsed.pathname))
}

// [label](url) and bare https addresses: an allowed link stays, any other is reduced to its label (or removed)
const fix_links = (text) => {
  let removed = 0
  let out = text.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,600})\)/g, (all, label, url) => {
    if (safe_link(url)) return all
    removed++
    return label
  })
  out = out.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()"'`\]]+)/gi, (all, before, url) => {
    const clean = url.replace(/[.,;:!?]+$/, '')
    if (safe_link(clean)) return all
    removed++
    return before + '[link removed]' + url.slice(clean.length)
  })
  return { text: out, removed }
}

/* ========================= THE ANSWER ========================= */

// Returns { text, redacted (secrets cut out), links (links removed) }
export const reply = (value) => {
  let text = String(value ?? '').replace(HIDDEN, '').replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]{0,200})?\/?>/gi, '').trim()
  let redacted = 0
  for (const secret of secrets()) {
    if (text.includes(secret)) {
      redacted++
      text = text.split(secret).join('[removed]')
    }
  }
  for (const shape of SECRET_SHAPES) {
    text = text.replace(shape, () => {
      redacted++
      return '[removed]'
    })
  }
  const linked = fix_links(text)
  text = linked.text
  if (text.length > MAX_REPLY) text = text.slice(0, MAX_REPLY).replace(/\s+\S*$/, '') + '…'
  return { text, redacted, links: linked.removed }
}

/* ========================= TOOL INPUT ========================= */

// a text argument from the model: trimmed, plain, capped; '' when it isn't text
export const text_arg = (value, max) => typeof value == 'string'
  ? value.normalize('NFKC').replace(HIDDEN, '').replace(/\s+/g, ' ').trim().slice(0, max)
  : ''
