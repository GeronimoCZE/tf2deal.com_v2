// The Kit a Kit Fabricator makes, as a small picture in the bottom left corner of the fabricator's own picture
// (Nikolas 2026-11-20: "always show output item picture (Get the name just by removing " Fabricator") If no item is
// found dont display anything ... In left bottom corner show the Kit output"). On item cards (/items, the home page, the
// item page's lists), the item page's picture and the trade page's tiles.
//
// "Professional Killstreak Rocket Launcher Kit Fabricator" -> "Professional Killstreak Rocket Launcher Kit": item_manager
// stores kits (type 'tool kit') with bp_sku "Non-Craftable <name>" and steam_sku "<name>", so both are looked up without
// "Non-Craftable ". Kits rarely change and are few (a few hundred), so their pictures are read on their own every
// 30 minutes, priced or not (the item list in memory only has priced items).
import { item_model } from '../model/Item.js'

const EVERY = 30 * 60 * 1000
const RETRY = 60 * 1000
const STEAM_ICONS = 'https://media.steampowered.com/apps/440/icons/'

let pictures = new Map() // kit name without "Non-Craftable " -> its small picture
const state = { kits: 0, last: 0, error: null }

const base = (name) => String(name ?? '').replace(/^Non-Craftable /, '').replace(/\s+/g, ' ').trim()
const first = (value) => Array.isArray(value) ? value.find((v) => typeof v == 'string' && v.trim()) || '' : (typeof value == 'string' ? value : '')

// a small, low resolution version of a kit's picture: Steam's economy pictures come in any size
// (".../economy/image/<id>/165x165" -> ".../96fx96f"); the item schema's ".png" pictures are small already
const small = (url) => {
  let src = first(url).trim()
  if (!src) return null
  if (src.startsWith('ms/')) src = STEAM_ICONS + src.slice(3)
  src = src.replace(/^http:\/\//i, 'https://')
  if (!/^https:\/\//.test(src)) return null
  const steam = src.match(/^(https:\/\/[^/]+\/economy\/image\/[^/?#]+)(\/[^/?#]*)?$/)
  return steam ? `${steam[1]}/96fx96f` : src
}

const is_fabricator = (item) => String(item?.type || '').toLowerCase() === 'tool kit fabricator' || / Kit Fabricator$/.test(String(item?.bp_sku || item?.name || ''))

/** the small picture of the Kit an item (a card, a page's item, a trade tile's item) makes; null for anything else, and
 * when that Kit isn't in the database (then nothing is shown) */
const of = (item) => {
  if (!item || !is_fabricator(item)) return null
  const name = base(item.bp_sku || item.name)
  if (!/ Kit Fabricator$/.test(name)) return null
  return pictures.get(name.slice(0, -' Fabricator'.length)) || null
}

/** adds kit_image to each Kit Fabricator of a list (the bot server's inventories, as the trade page gets them) */
const mark = (items) => {
  if (!Array.isArray(items)) return items
  for (const item of items) {
    const image = of(item)
    if (image && item && typeof item == 'object') item.kit_image = image
  }
  return items
}

// "Killstreak <weapon> Kit" names only: the bp_sku index answers that without reading every item
const read = async () => {
  if (process.db_status?.connected !== true) throw new Error('the database is not connected')
  const docs = await item_model.find({ bp_sku: { $regex: 'Killstreak .+ Kit$' } }, { _id: 0, bp_sku: 1, steam_sku: 1, type: 1, image: 1 })
    .lean().maxTimeMS(30 * 1000)
  const next = new Map()
  for (const doc of docs) {
    if (String(doc.type || '').toLowerCase() !== 'tool kit') continue
    const image = small(doc.image)
    if (!image) continue
    for (const name of [doc.bp_sku, doc.steam_sku]) {
      const key = base(name)
      if (key && !next.has(key)) next.set(key, image)
    }
  }
  pictures = next
  state.kits = next.size
  state.last = Date.now()
  state.error = null
}

let timer = null
const start = () => {
  if (timer) return
  const run = () => read()
    .then(() => { timer = setTimeout(run, EVERY) })
    .catch((error) => {
      if (state.error !== error.message) console.log(`Kit pictures: not read (${error.message}), trying again in a minute`)
      state.error = error.message
      timer = setTimeout(run, RETRY)
    })
  timer = setTimeout(run, 5 * 1000) // after the database connects
  timer.unref?.()
}

const status = () => ({ ...state })

export { start, of, mark, small, status }
