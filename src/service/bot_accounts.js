// Bot accounts in the admin panel (js/admin_bot_manager.js → Bot manager → Bots, routes: api/routes/admin.js →
// /bot_accounts/*).
//
// The accounts live in bot_manager's collection `steam_bots` (model/SteamBot.js), which the site shares. The panel
// reads them from there, so it shows what is saved even while bot_manager isn't connected, and adds and deletes
// accounts there. What only a running bot knows (online, inventory, listings, offers) comes from bot_manager
// (admin:bots:accounts) and is added when it's connected.
//
// The login (password, shared / identity secret, backpack.tf key and token) is encrypted like bot_manager does it
// (its src/utils/encoder.js: aes-256-gcm, key from PASSWORD in .env). The site's PASSWORD is the one it already sends
// bot_manager with every request, so both must be the same. A login is never returned or logged.
// A new enabled account is logged in at once when bot_manager is connected (admin:bots:enable); otherwise bot_manager
// logs it in when it starts.
import crypto from 'crypto'
import SteamTotp from 'steam-totp'
import { bot_account_model } from '../model/SteamBot.js'
import * as bot_manager from './bot_manager.js'

const SECRET_FIELDS = ['password', 'sharedSecret', 'identitySecret', 'bptf_key', 'bptf_token']
const TYPES = ['trade', 'warehouse']
const ENABLED = ['pending', 'active']
const HARD_MAX = 12 // bot_manager never runs more

const escape_regex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// bot_manager's encrypt(): base64 of salt (16) + iv (12) + auth tag (16) + ciphertext
export const encrypt = (text, password) => {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(password, salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

// the same checks bot_manager makes (its src/utils/botAccounts.js), so it can log in with what is saved
const valid_secret = (value) => {
  const v = value.trim()
  const bytes = /^[0-9a-f]{40}$/i.test(v) ? 20 : Buffer.from(v, 'base64').length
  if(bytes < 16){ return false }
  try { return /^\d{5}$|^[A-Z0-9]{5}$/.test(SteamTotp.generateAuthCode(v)) } catch (e) { return false }
}
const LABELS = { password: 'Steam password', sharedSecret: 'Shared secret', identitySecret: 'Identity secret', bptf_key: 'backpack.tf API key', bptf_token: 'backpack.tf access token' }
const check_field = (field, value) => {
  if(typeof value != 'string' || !value.trim()){ throw `${LABELS[field]} is missing.` }
  if((field == 'sharedSecret' || field == 'identitySecret') && !valid_secret(value)){ throw `${LABELS[field]} is not valid (base64 from the .maFile).` }
  if(field == 'password' && value.length > 256){ throw 'The password is too long.' }
  if((field == 'bptf_key' || field == 'bptf_token') && !/^[A-Za-z0-9+/=_.-]{8,256}$/.test(value.trim())){ throw `${LABELS[field]} is not valid.` }
  return field == 'password' ? value : value.trim()
}
const password = () => {
  if(!process.env.PASSWORD){ throw 'PASSWORD is missing in .env: it must be the same as bot_manager\'s, which encrypts the bot logins with it.' }
  return process.env.PASSWORD
}

// one account as saved: no login, only whether each part is set
const row = (d) => ({
  id: d.id,
  accountName: d.accountName,
  type: d.type,
  status: d.status,
  enabled: d.status != 'disabled',
  steamid: d.accountSteamid || null,
  name: d.profileName || null,
  tradeURL: d.accountTradeURL || null,
  level: d.accountLevel || 0,
  created: d.accountCreated || 0,
  updated: d.updated || 0,
  disabledAt: d.disabledAt || 0,
  disabledBy: d.disabledBy || null,
  hasBptfKey: !!d.bptf_key,
  hasBptfToken: !!d.bptf_token
})

const find_doc = async (account) => {
  const name = String(account || '').trim()
  if(!name){ throw 'Pick a bot.' }
  const doc = await bot_account_model.findOne({ accountName: new RegExp(`^${escape_regex(name)}$`, 'i') }).lean()
  if(!doc){ throw 'No bot account with that name in the database.' }
  return doc
}

// bot_manager's own view of the accounts (running, online, inventory …), by account name; null while it's offline
const live_accounts = async (admin) => {
  if(!bot_manager.online()){ return null }
  const res = await bot_manager.ask('admin:bots:accounts', {}, admin)
  if(res.status != 'ok'){ return null }
  return { ...res.data, by_name: new Map((res.data?.accounts || []).map((a) => [String(a.accountName).toLowerCase(), a])) }
}

const fail = (error) => ({ status: 'error', message: typeof error == 'string' ? error : (error?.message || 'Something failed.') })

// every account in the database, with bot_manager's live state when it's connected
export const list = async (admin) => {
  const [docs, live] = await Promise.all([bot_account_model.find({}).sort({ id: 1 }).lean(), live_accounts(admin)])
  return {
    status: 'ok',
    live: !!live,
    maxBots: live?.maxBots ?? null,
    hardMax: live?.hardMax ?? HARD_MAX,
    running: live ? (Array.isArray(live.running) ? live.running.length : live.running) : null,
    // what is saved comes from the database, what only a running bot knows from bot_manager
    accounts: docs.map((d) => ({ ...(live?.by_name.get(d.accountName.toLowerCase()) || {}), ...row(d), saved: true }))
  }
}

// { accountName, type, password, sharedSecret, identitySecret, bptf_key, bptf_token, enabled, start }
export const add = async (p = {}, admin) => {
  try {
    const accountName = typeof p.accountName == 'string' ? p.accountName.trim() : ''
    if(!/^[A-Za-z0-9_]{3,64}$/.test(accountName)){ throw 'The account name is 3 to 64 letters, digits or _.' }
    const type = p.type ? String(p.type) : 'trade'
    if(!TYPES.includes(type)){ throw 'Kind is trade or warehouse.' }
    const fields = {
      password: check_field('password', p.password),
      sharedSecret: check_field('sharedSecret', p.sharedSecret),
      identitySecret: check_field('identitySecret', p.identitySecret)
    }
    // trade bots list on backpack.tf with their own key and token; warehouse bots don't need them
    for (const f of ['bptf_key', 'bptf_token']) {
      if(type == 'trade' || (typeof p[f] == 'string' && p[f].trim())){ fields[f] = check_field(f, p[f]) }
    }
    const key = password()
    if(await bot_account_model.exists({ accountName: new RegExp(`^${escape_regex(accountName)}$`, 'i') })){ throw 'A bot with that account name is saved already.' }
    const enabled = p.enabled !== false
    if(enabled && await bot_account_model.countDocuments({ status: { $in: ENABLED } }) >= HARD_MAX){ throw `${HARD_MAX} bots are enabled already: disable one first.` }
    const last = await bot_account_model.findOne({}).sort({ id: -1 }).select('id').lean()
    const now = Date.now()
    const doc = await bot_account_model.create({
      id: (Number(last?.id) || 0) + 1,
      accountName,
      type,
      status: enabled ? 'pending' : 'disabled',
      disabledAt: enabled ? 0 : now,
      disabledBy: enabled ? '' : String(admin || 'admin'),
      updated: now,
      ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encrypt(v, key)]))
    })
    console.log(`bot accounts: ${accountName} (${type}) added by ${admin || 'admin'}${enabled ? '' : ', disabled'}`)

    // log it in now when bot_manager is connected
    let started = false, note = null
    if(!enabled){ note = 'It is saved disabled.' }
    else if(p.start === false){ note = 'It logs in when you enable it, or when bot_manager starts next.' }
    else if(!bot_manager.online()){ note = 'bot_manager isn\'t connected: it logs the bot in when it starts.' }
    else {
      const res = await bot_manager.ask('admin:bots:enable', { bot: accountName }, admin)
      started = res.status == 'ok' && !!res.data?.started
      note = res.status == 'ok' ? (started ? null : 'bot_manager didn\'t log it in yet.') : `Saved, but bot_manager didn't log it in: ${res.message}`
    }
    return { status: 'ok', account: row(doc.toObject()), started, note }
  } catch (error) {
    return fail(error)
  }
}

// change a saved login (only the parts sent) or the kind. bot_manager applies the backpack.tf key and token at once
// when it's connected (admin:bots:update); the rest is used at the bot's next login.
export const update = async (p = {}, admin) => {
  try {
    const doc = await find_doc(p.bot)
    const plain = {}
    for (const f of SECRET_FIELDS) {
      if(p[f] !== undefined && p[f] !== null && p[f] !== ''){ plain[f] = check_field(f, p[f]) }
    }
    if(p.type && !TYPES.includes(String(p.type))){ throw 'Kind is trade or warehouse.' }
    if(!Object.keys(plain).length && !p.type){ throw 'Fill in what changes.' }
    if(bot_manager.online()){
      const res = await bot_manager.ask('admin:bots:update', { bot: doc.accountName, ...plain, ...(p.type ? { type: String(p.type) } : {}) }, admin)
      return res.status == 'ok' ? { status: 'ok', ...res.data } : res
    }
    const key = password()
    const set = Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, encrypt(v, key)]))
    if(p.type){ set.type = String(p.type) }
    await bot_account_model.updateOne({ _id: doc._id }, { $set: { ...set, updated: Date.now() } })
    console.log(`bot accounts: ${doc.accountName} updated by ${admin || 'admin'}: ${Object.keys(set).join(', ')}`)
    return { status: 'ok', changed: Object.keys(set), saved_only: true }
  } catch (error) {
    return fail(error)
  }
}

// enable / disable straight in the database, for when bot_manager isn't connected (when it is, the panel asks
// bot_manager, which also logs the bot in or lets its open offers finish first). Used when bot_manager starts next.
export const set_enabled = async (p = {}, admin) => {
  try {
    if(bot_manager.online()){ throw 'bot_manager is connected: use its Enable / Disable, which also logs the bot in or off.' }
    const doc = await find_doc(p.bot)
    const enabled = p.enabled === true
    if(enabled && doc.status == 'disabled' && await bot_account_model.countDocuments({ status: { $in: ENABLED } }) >= HARD_MAX){ throw `${HARD_MAX} bots are enabled already: disable one first.` }
    const set = enabled ? { status: doc.status == 'active' ? 'active' : 'pending', disabledAt: 0, disabledBy: '' }
      : { status: 'disabled', disabledAt: Date.now(), disabledBy: String(admin || 'admin') }
    await bot_account_model.updateOne({ _id: doc._id }, { $set: { ...set, updated: Date.now() } })
    console.log(`bot accounts: ${doc.accountName} ${enabled ? 'enabled' : 'disabled'} in the database by ${admin || 'admin'}`)
    return { status: 'ok' }
  } catch (error) {
    return fail(error)
  }
}

// delete a disabled account that isn't running; `confirm` is the account name typed again. With bot_manager
// connected it deletes it (admin:bots:remove), which also drops the login it keeps in memory.
export const remove = async (p = {}, admin) => {
  try {
    const doc = await find_doc(p.bot)
    if(String(p.confirm || '').trim().toLowerCase() != doc.accountName.toLowerCase()){ throw 'Type the account name to confirm.' }
    if(doc.status != 'disabled'){ throw 'Disable the bot first.' }
    if(bot_manager.online()){
      const res = await bot_manager.ask('admin:bots:remove', { bot: doc.accountName, confirm: doc.accountName }, admin)
      if(res.status != 'ok'){ throw /still_(running|stopping)/.test(res.message) ? 'The bot is still running or logging off. Try again once it has logged off.' : res.message }
    }
    await bot_account_model.deleteOne({ _id: doc._id })
    console.log(`bot accounts: ${doc.accountName} removed by ${admin || 'admin'}`)
    return { status: 'ok', removed: doc.accountName }
  } catch (error) {
    return fail(error)
  }
}
