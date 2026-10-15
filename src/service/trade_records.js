import { item_model } from '../model/Item.js'
import { effect_model } from '../model/Effect.js'
import { pure_model } from '../model/Pure.js'

// Trade records are written to the `trades` collection by the bot server, in one of two shapes:
// - trades made on the site: toGive / toReceive = { keys, ref, rec, scrap, items: [{ bp_sku, qualityID, effectID, type,
//   image, buy, sell, user_stock: [{ a, ks, f }] }] }. toGive is what our bot gave.
// - the newer one, also for offers people send the bots themselves: itemsToGive / itemsToReceive hold the Steam offer's
//   items (assetid, market_hash_name, icon_url, tags, descriptions), keys and metal included, and internalTrade marks
//   trades between our own bots.
// site_shape() turns records of either shape into the first one, so latest trades and Profile -> Trades read one shape.
// Steam items are matched to our item database for the name, picture and price the site uses for them; an item that
// isn't there keeps Steam's name and picture.

const IMG_PREFIX = 'https://community.cloudflare.steamstatic.com/economy/image/'
const PURE_NAMES = { 'Mann Co. Supply Crate Key': 'keys', 'Refined Metal': 'ref', 'Reclaimed Metal': 'rec', 'Scrap Metal': 'scrap' }
const PURE_SKUS = { '5021;6': 'keys', '5002;6': 'ref', '5001;6': 'rec', '5000;6': 'scrap' }
// Steam's quality tag (name or internal name) -> our qualityID
const QUALITIES = {
    normal: 0, genuine: 1, rarity1: 1, vintage: 3, unusual: 5, rarity4: 5, unique: 6, community: 7, valve: 8, developer: 8,
    'self-made': 9, selfmade: 9, strange: 11, haunted: 13, "collector's": 14, collectors: 14, 'decorated weapon': 15, paintkitweapon: 15
}
const KS_WORDS = /\b(?:(Professional|Specialized) )?Killstreak /

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
// older records are in seconds
const to_ms = (ts) => (num(ts) > 0 && num(ts) < 1e11) ? num(ts) * 1000 : num(ts)

const ks_tier = (value) => {
    const n = Number(value)
    if ([0, 1, 2, 3].includes(n)) { return n }
    const name = String(value ?? '').trim().toLowerCase()
    return name.startsWith('pro') ? 3 : name.startsWith('spec') ? 2 : name.startsWith('kill') ? 1 : 0
}

const is_site_item = (item) => item && typeof item == 'object' && (Array.isArray(item.user_stock) || typeof item.bp_sku == 'string')
const steam_name = (item) => String(item?.market_hash_name || item?.market_name || item?.name || '').trim()
const tag = (item, category) => {
    const found = (Array.isArray(item?.tags) ? item.tags : []).find((t) => String(t?.category || '').toLowerCase() == category)
    return found ? String(found.name || found.localized_tag_name || found.internal_name || '') : ''
}
const descriptions = (item) => (Array.isArray(item?.descriptions) ? item.descriptions : []).map((d) => String(d?.value ?? ''))

// keys / ref / rec / scrap, or null for anything else
const pure_kind = (item) => typeof item == 'string' ? (PURE_SKUS[item] || PURE_NAMES[item] || null)
    : (PURE_NAMES[steam_name(item)] || PURE_SKUS[item?.sku] || null)

// what a Steam item tells about itself
const parse = (item) => {
    const name = steam_name(item)
    const is_kit = / Kit( Fabricator)?$/.test(name) // a killstreak kit is its own item, not a killstreak weapon
    const ks_match = is_kit ? null : name.match(KS_WORDS)
    const ks = ks_match ? ({ Professional: 3, Specialized: 2 }[ks_match[1]] || 1) : 0
    const descs = descriptions(item)
    const f = (/^Festivized /.test(name) || descs.includes('Festivized')) ? 1 : 0
    const base = name.replace(/^Festivized /, '').replace(is_kit ? '' : KS_WORDS, '').trim()
    const quality_tag = tag(item, 'quality').toLowerCase()
    const effect = descs.map((d) => d.match(/^★ Unusual Effect: (.+)$/)?.[1]?.trim()).find(Boolean) || ''
    return {
        name, base, ks, f, effect,
        quality: quality_tag in QUALITIES ? QUALITIES[quality_tag] : (/^Strange /.test(base) ? 11 : /^Unusual /.test(base) ? 5 : 6),
        craftable: !descs.some((d) => /Not Usable in Crafting/i.test(d)),
        assetid: String(item?.assetid ?? item?.id ?? ''),
        image: item?.icon_url ? IMG_PREFIX + item.icon_url : '',
        type: tag(item, 'type')
    }
}

// the bp_sku we would give the item, then the same name with or without "The " (Steam and backpack.tf don't always agree)
const bp_names = (p) => {
    const name = p.quality == 5 && p.effect ? `${p.effect} ${p.base.replace(/^Unusual /, '')}` : p.base
    const prefix = p.craftable ? '' : 'Non-Craftable '
    const other = p.quality == 6 ? (name.startsWith('The ') ? name.slice(4) : `The ${name}`) : null
    return [prefix + name, ...(other ? [prefix + other] : [])]
}

// our item database entries for these Steam items: { by_bp: Map(bp_sku -> doc), effects: Map(effect name -> id) }
// (looked up by bp_sku only, which is indexed)
const lookup = async (parsed) => {
    const names = [...new Set(parsed.flatMap(bp_names))]
    const effect_names = [...new Set(parsed.map((p) => p.effect).filter(Boolean))]
    if (!names.length) { return { by_bp: new Map(), effects: new Map() } }

    const [docs, effects] = await Promise.all([
        item_model.find({ bp_sku: { $in: names } }, {
            _id: 0, bp_sku: 1, qualityID: 1, effectID: 1, type: 1, image: 1, buy: 1, sell: 1,
            'killstreak.ks_tier': 1, 'killstreak.kt': 1, 'killstreak.buy': 1, 'killstreak.sell': 1
        }).lean(),
        effect_names.length ? effect_model.find({ name: { $in: effect_names } }, { _id: 0, ID: 1, name: 1 }).lean() : []
    ])
    return { by_bp: new Map(docs.map((d) => [d.bp_sku, d])), effects: new Map(effects.map((e) => [e.name, Number(e.ID) || 0])) }
}

const find_doc = (p, found) => bp_names(p).map((name) => found.by_bp.get(name)).find(Boolean) || null

// buy / sell of one copy: its killstreak tier's prices when the item has them (left out when we have no price)
const prices = (doc, ks) => {
    const tier = ks > 0 ? (doc?.killstreak || []).find((k) => ks_tier(k?.kt ?? k?.ks_tier) == ks) : null
    const buy = num(tier?.buy) || num(doc?.buy)
    const sell = num(tier?.sell) || num(doc?.sell)
    return { ...(buy > 0 ? { buy } : {}), ...(sell > 0 ? { sell } : {}) }
}

// the key price in ref now, for newer records that don't say what it was (cached for 10 minutes)
const key_cache = { value: 0, at: 0 }
const key_price_now = async () => {
    if (Date.now() - key_cache.at > 10 * 60 * 1000) {
        const pure = await pure_model.findOne({ name: 'Mann Co. Supply Crate Key' }, { value_raw: 1 }).lean().catch(() => null)
        Object.assign(key_cache, { value: num(pure?.value_raw), at: Date.now() })
    }
    return key_cache.value
}

// one side of a newer record (an array of Steam items) as { keys, ref, rec, scrap, items, unknown }
const side_from_steam = (list, found) => {
    const side = { keys: 0, ref: 0, rec: 0, scrap: 0, items: [], unknown: 0 }
    const grouped = new Map()
    for (const item of list) {
        const pure = pure_kind(item)
        if (pure) { side[pure] += Math.max(1, num(item?.amount)); continue }
        if (is_site_item(item)) { side.items.push(item); continue }
        const p = parse(item)
        if (!p.name) { side.unknown++; continue }

        const doc = find_doc(p, found)
        const entry = {
            bp_sku: doc?.bp_sku || bp_names(p)[0],
            qualityID: String(doc?.qualityID ?? p.quality),
            effectID: num(doc?.effectID) || found.effects.get(p.effect) || 0,
            type: doc?.type || p.type,
            image: doc?.image || p.image
        }
        const key = `${entry.bp_sku}|${entry.qualityID}|${entry.effectID}`
        if (!grouped.has(key)) { grouped.set(key, { ...entry, user_stock: [] }) }
        grouped.get(key).user_stock.push({ a: p.assetid, ks: p.ks, f: p.f, ...prices(doc, p.ks) })
    }
    side.items.push(...grouped.values())
    return side
}

const is_newer_shape = (record) => !record?.toGive && !record?.toReceive && (Array.isArray(record?.itemsToGive) || Array.isArray(record?.itemsToReceive))

// Records of either shape -> [{ _id, tradeID, partnerSteamID, timestamp (ms), key_value, internalTrade, toGive, toReceive,
// incomplete }]. incomplete: some item had no name (Steam didn't send its description), so the trade can't be drawn whole.
const site_shape = async (records) => {
    const steam_items = records.filter(is_newer_shape)
        .flatMap((r) => [...(r.itemsToGive || []), ...(r.itemsToReceive || [])])
        .filter((item) => !pure_kind(item) && !is_site_item(item) && steam_name(item))
    const found = await lookup(steam_items.map(parse))
    const key_now = records.some((r) => is_newer_shape(r) && !(num(r.key_value) || num(r.key_price))) ? await key_price_now() : 0

    return records.map((record) => {
        const shaped = {
            _id: record._id,
            tradeID: record.tradeID,
            partnerSteamID: record.partnerSteamID,
            timestamp: to_ms(record.timestamp),
            key_value: num(record.key_value) || num(record.key_price) || undefined,
            internalTrade: record.internalTrade === true,
            toGive: record.toGive ?? null,
            toReceive: record.toReceive ?? null,
            incomplete: false
        }
        if (is_newer_shape(record)) {
            shaped.key_value = shaped.key_value || key_now || undefined
            shaped.toGive = side_from_steam(record.itemsToGive || [], found)
            shaped.toReceive = side_from_steam(record.itemsToReceive || [], found)
            shaped.incomplete = shaped.toGive.unknown + shaped.toReceive.unknown > 0
        }
        return shaped
    })
}

export { site_shape, to_ms, parse, bp_names }
