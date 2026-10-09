// Direct buy links: tf2deal.com/buy/<assetid> (page: routes/router.js -> buy_link, modal: js/plugins/buy_link.js)
//
// The assetid is looked up in the bots' stock (item_instances -> stock.items[].a). Usually one copy matches.
// When the same assetid shows up more than once (on two items, or on two bots), the visitor picks one, and the
// bot server gets the bot's steamid and the item's bp_sku next to the assetid so it knows which copy was meant.
import * as fn from '../fn.js'
import * as app from '../app.js'
import { item_model } from '../model/Item.js'

export const ASSETID = /^\d{1,20}$/

const IMG_PREFIX = 'https://community.fastly.steamstatic.com/economy/image/'
const KS_NAMES = ['', 'Killstreak', 'Specialized Killstreak', 'Professional Killstreak']
const QUALITY_WORDS = ['Strange', 'Genuine', 'Vintage', 'Haunted', "Collector's", 'Unusual', 'Decorated', 'Community', 'Self-Made', 'Normal']

const ks_tier = (value) => {
  if (value === undefined || value === null || value === '') return 0
  if (!isNaN(Number(value))) return Number(value)
  const name = String(value).trim().toLowerCase()
  if (name.startsWith('pro')) return 3
  if (name.startsWith('spec')) return 2
  if (name.startsWith('kill')) return 1
  return 0
}

// a price in ref; {key, metal} is turned into ref with the item's key price
const to_ref = (value, key_ref) => {
  if (value && typeof value == 'object') {
    const ref = (Number(value.key) || 0) * (Number(key_ref) || 0) + (Number(value.metal) || 0)
    return ref > 0 ? ref : 0
  }
  return Number(value) > 0 ? Number(value) : 0
}

// What the visitor pays: the copy's killstreak tier price when it has one, else the item's price
// (same order as the trade page).
const sell_price = (doc, asset, key_ref) => {
  const tier = Number(asset?.ks) || 0
  if (tier > 0) {
    const tiers = Array.isArray(doc.killstreak) ? doc.killstreak : (doc.killstreak?.killstreaks || [])
    const entry = tiers.find((t) => ks_tier(t?.ks_tier ?? t?.kt ?? t?.tier) == tier)
    const price = to_ref(entry?.sell, key_ref)
    if (price > 0) return price
  }
  const own = Number(asset?.sell) || 0
  const base = Number(doc.sell) || 0
  return own > base ? own : base
}

// "Rocket Launcher" + festivized + tier 3 -> "Festivized Professional Killstreak Rocket Launcher",
// "Strange Rocket Launcher" -> "Strange Professional Killstreak Rocket Launcher"
const display_name = (bp_sku, asset) => {
  const words = [asset?.f ? 'Festivized' : '', KS_NAMES[Number(asset?.ks) || 0] || ''].filter(Boolean).join(' ')
  if (!words) return bp_sku
  const name = String(bp_sku || '')
  const quality = QUALITY_WORDS.find((q) => name.startsWith(q + ' '))
  if (quality) return `${quality} ${words} ${name.slice(quality.length + 1)}`
  return `${words} ${name.replace(/^The /, '')}`
}

const words = (value) => (Array.isArray(value) ? value : [value]).filter((v) => typeof v == 'string' && v.trim()).map((v) => v.trim().slice(0, 60))

// paint, spells, parts, sheen and killstreaker: what tells two copies of the same item apart
const details = (asset) => {
  const at = asset?.at || {}
  return [...words(at.paint), ...words(at.spells), ...words(at.strangeParts), ...words(at.sheen), ...words(at.killstreaker)].slice(0, 8)
}

// Every bot copy that carries this assetid, ready for the page (one entry per item + bot).
export const find = async (assetid) => {
  const id = String(assetid ?? '')
  if (!ASSETID.test(id) || process.db_status?.connected !== true) return []

  const values = [id]
  if (Number.isSafeInteger(Number(id))) values.push(Number(id))
  const docs = await item_model.find(
    { 'stock.items.a': { $in: values } },
    { bp_sku: 1, qualityID: 1, effectID: 1, image: 1, image_large: 1, sell: 1, killstreak: 1, 'bptf_data.update_key_price': 1, 'stock.items': 1 }
  ).limit(10).lean()

  const bots = new Map((Array.isArray(app.fp_data?.bots) ? app.fp_data.bots : [])
    .filter((b) => b?.steamid).map((b) => [String(b.steamid), String(b.personaname || b.name || '')]))
  const copies = []
  const seen = new Set()

  for (const doc of docs) {
    const key_ref = Number(doc.bptf_data?.update_key_price) || Number(app.key_price?.metal) || 0
    for (const asset of (Array.isArray(doc.stock?.items) ? doc.stock.items : [])) {
      if (String(asset?.a) !== id) continue
      const bot = asset?.ownerId ? String(asset.ownerId) : ''
      if (seen.has(`${doc.bp_sku}|${bot}`)) continue
      seen.add(`${doc.bp_sku}|${bot}`)

      const sell = sell_price(doc, asset, key_ref)
      copies.push({
        assetid: id,
        bot,
        bot_name: bots.get(bot) || '',
        bp_sku: doc.bp_sku,
        name: display_name(doc.bp_sku, asset),
        qualityID: doc.qualityID,
        effectID: Number(doc.effectID) > 0 ? Number(doc.effectID) : 0,
        image: asset?.icon_url ? IMG_PREFIX + asset.icon_url : doc.image,
        image_large: doc.image_large || doc.image,
        ks: Number(asset?.ks) || 0,
        festivized: !!asset?.f,
        details: details(asset),
        sell,
        price: fn.price_text(sell, key_ref)
      })
    }
  }
  return copies
}

// The one copy a trade request means. `bot` and `bp_sku` come from the picker; an old page without them still
// works when the assetid matches a single copy.
export const pick = async (assetid, bot, bp_sku) => {
  const copies = await find(assetid)
  const matching = copies.filter((c) => (!bot || c.bot === String(bot)) && (!bp_sku || c.bp_sku === String(bp_sku)))
  if (matching.length === 1) return { copy: matching[0] }
  return { error: matching.length > 1 ? 'pick' : 'gone' }
}
