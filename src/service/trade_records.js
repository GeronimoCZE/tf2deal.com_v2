import fetch from 'node-fetch'
import { item_model } from '../model/Item.js'
import { effect_model } from '../model/Effect.js'
import { pure_model } from '../model/Pure.js'

// Trade records are written to the `trades` collection by the bot server (bot_manager), whose code the site can't see.
// site_shape() reads every layout it is likely to save and turns each record into the one the site draws:
//   toGive / toReceive = { keys, ref, rec, scrap, items: [{ bp_sku, qualityID, effectID, type, image, buy, sell,
//   user_stock: [{ a, ks, f, buy?, sell? }] }] }, toGive being what our bot gave.
//
// - The sides: toGive / toReceive, or itemsToGive / itemsToReceive (the fields of model/Trade.js).
// - A side: { keys, ref, rec, scrap, metal, items: [...] }, or just the list of items.
// - An item in that list:
//   - a site item (it has user_stock), kept as it is;
//   - copies named by bp_sku: { bp_sku, assetid | a | id | assetids, ks | killstreak, f | festivized, qualityID,
//     effectID, buy, sell }, where the bp_sku may carry the killstreak or "Festivized " (like the ones the bots have
//     the item manager price);
//   - a Steam item: market_hash_name, icon_url, tags, descriptions;
//   - a Steam item saved without its description (only classid / instanceid): Steam is asked for it;
//   - keys or metal, as any of the above or as a "5021;6" style sku.
// - internalTrade marks trades between our own bots.
// Every item is matched to our item database for the name, picture and price the site uses for it; one that isn't
// there keeps Steam's name and picture.

const IMG_PREFIX = 'https://community.cloudflare.steamstatic.com/economy/image/'
const PURE_NAMES = { 'Mann Co. Supply Crate Key': 'keys', 'Refined Metal': 'ref', 'Reclaimed Metal': 'rec', 'Scrap Metal': 'scrap' }
const PURE_SKUS = { '5021;6': 'keys', '5002;6': 'ref', '5001;6': 'rec', '5000;6': 'scrap' }
// Steam's quality tag (name or internal name) -> our qualityID
const QUALITIES = {
    normal: 0, genuine: 1, rarity1: 1, vintage: 3, unusual: 5, rarity4: 5, unique: 6, community: 7, valve: 8, developer: 8,
    'self-made': 9, selfmade: 9, strange: 11, haunted: 13, "collector's": 14, collectors: 14, 'decorated weapon': 15, paintkitweapon: 15
}
const KS_WORDS = /\b(?:(Professional|Specialized) )?Killstreak /
const TF2_SKU = /^\d+;\d+/

const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0
const yes = (v) => v === true || v === 1 || v === '1' || v === 'true'

// ms from a timestamp in ms or seconds (older records are in seconds), a Date or a date string; 0 when there is none
const to_ms = (ts) => {
    const n = ts instanceof Date ? ts.getTime() : (typeof ts == 'string' && ts.trim() && !Number.isFinite(Number(ts))) ? Date.parse(ts) : Number(ts)
    if (!Number.isFinite(n) || n <= 0) { return 0 }
    return n < 1e11 ? n * 1000 : n
}
const id_time = (id) => typeof id?.getTimestamp == 'function' ? id.getTimestamp().getTime() : 0
const record_time = (r) => to_ms(r?.timestamp) || to_ms(r?.time) || to_ms(r?.created) || to_ms(r?.createdAt) || to_ms(r?.date) || id_time(r?._id)

const ks_tier = (value) => {
    const n = Number(value)
    if ([0, 1, 2, 3].includes(n)) { return n }
    const name = String(value ?? '').trim().toLowerCase()
    return name.startsWith('pro') ? 3 : name.startsWith('spec') ? 2 : name.startsWith('kill') ? 1 : 0
}

const is_object = (item) => item && typeof item == 'object' && !Array.isArray(item)
const is_site_item = (item) => is_object(item) && Array.isArray(item.user_stock)
const steam_name = (item) => String(item?.market_hash_name || item?.market_name || item?.name || '').trim()
const bp_name = (item) => typeof item?.bp_sku == 'string' ? item.bp_sku.trim() : (typeof item?.sku == 'string' && !TF2_SKU.test(item.sku) ? item.sku.trim() : '')
const tag = (item, category) => {
    const tags = Array.isArray(item?.tags) ? item.tags : is_object(item?.tags) ? Object.values(item.tags) : []
    const found = tags.find((t) => String(t?.category || '').toLowerCase() == category)
    return found ? String(found.name || found.localized_tag_name || found.internal_name || '') : ''
}
const descriptions = (item) => (Array.isArray(item?.descriptions) ? item.descriptions : is_object(item?.descriptions) ? Object.values(item.descriptions) : [])
    .map((d) => String(d?.value ?? ''))
// a quality as our qualityID, from a number or a name ("Strange")
const quality_of = (q) => (q == null || q === '') ? null : Number.isFinite(Number(q)) ? Number(q) : (QUALITIES[String(q).toLowerCase()] ?? null)
const amount = (item) => Math.max(1, Math.floor(num(item?.amount ?? item?.count ?? item?.quantity)) || 1)

// keys / ref / rec / scrap, or null for anything else
const pure_kind = (item) => {
    if (typeof item == 'string') { return PURE_SKUS[item.trim()] || PURE_NAMES[item.trim()] || null }
    if (!is_object(item) || is_site_item(item)) { return null }
    return PURE_NAMES[steam_name(item)] || PURE_NAMES[bp_name(item)] || PURE_SKUS[item.sku] || null
}

// a name with the killstreak and "Festivized " taken out: { name, ks, f }
const strip_name = (name) => {
    const is_kit = / Kit( Fabricator)?$/.test(name) // a killstreak kit is its own item, not a killstreak weapon
    const ks_match = is_kit ? null : name.match(KS_WORDS)
    return {
        name: name.replace(/\bFestivized /, '').replace(is_kit ? '' : KS_WORDS, '').replace(/\s+/g, ' ').trim(),
        ks: ks_match ? ({ Professional: 3, Specialized: 2 }[ks_match[1]] || 1) : 0,
        f: /\bFestivized /.test(name) ? 1 : 0
    }
}
const with_or_without_the = (name) => name.startsWith('The ') ? name.slice(4) : `The ${name}`

// what a Steam item tells about itself
const parse = (item) => {
    const name = steam_name(item)
    const stripped = strip_name(name)
    const descs = descriptions(item)
    const quality_tag = tag(item, 'quality').toLowerCase()
    return {
        name,
        base: stripped.name,
        ks: stripped.ks,
        f: (stripped.f || descs.includes('Festivized')) ? 1 : 0,
        effect: descs.map((d) => d.match(/^★ Unusual Effect: (.+)$/)?.[1]?.trim()).find(Boolean) || '',
        quality: quality_tag in QUALITIES ? QUALITIES[quality_tag] : (/^Strange /.test(stripped.name) ? 11 : /^Unusual /.test(stripped.name) ? 5 : 6),
        craftable: !descs.some((d) => /Not Usable in Crafting/i.test(d)),
        assetid: String(item?.assetid ?? item?.id ?? ''),
        image: item?.icon_url ? IMG_PREFIX + item.icon_url : '',
        type: tag(item, 'type')
    }
}

// the bp_sku we would give a Steam item, then the same name with or without "The " (Steam and backpack.tf don't always agree)
const bp_names = (p) => {
    const name = p.quality == 5 && p.effect ? `${p.effect} ${p.base.replace(/^Unusual /, '')}` : p.base
    const prefix = p.craftable ? '' : 'Non-Craftable '
    return [prefix + name, ...(p.quality == 6 ? [prefix + with_or_without_the(name)] : [])]
}

// The copies one item of a record stands for, before they are matched to our item database:
// { names (bp_sku candidates, best first), quality, effect (name), effectID, ks, f, assetids, image, type, buy, sell }
const copies_of = (item) => {
    const named = bp_name(item)
    const steam = steam_name(item) ? parse(item) : null
    if (!named && !steam) { return null }

    const stripped = named ? strip_name(named) : null
    const ids = Array.isArray(item?.assetids) ? item.assetids : Array.isArray(item?.assets) ? item.assets.map((a) => a?.assetid ?? a?.a ?? a?.id ?? a) : null
    const one = item?.assetid ?? item?.a ?? item?.id ?? item?.assetID ?? steam?.assetid ?? ''
    const effect_id = num(item?.effectID ?? item?.effect_id ?? (Number.isFinite(Number(item?.effect)) ? item.effect : 0))
    const price = num(item?.price)
    return {
        names: named ? [stripped.name, with_or_without_the(stripped.name), named] : bp_names(steam),
        quality: item?.qualityID ?? item?.quality_id ?? quality_of(item?.quality) ?? steam?.quality ?? null,
        effect: (typeof item?.effect == 'string' && !Number.isFinite(Number(item.effect)) ? item.effect : '') || steam?.effect || '',
        effectID: effect_id,
        ks: ks_tier(item?.ks ?? item?.killstreak ?? item?.kt ?? item?.ks_tier) || stripped?.ks || steam?.ks || 0,
        f: (yes(item?.f) || yes(item?.festivized) || yes(item?.festive) || stripped?.f || steam?.f) ? 1 : 0,
        assetids: (ids?.length ? ids : Array(amount(item)).fill(one)).map((a) => String(a ?? '')),
        image: item?.image || (item?.icon_url ? IMG_PREFIX + item.icon_url : '') || steam?.image || '',
        type: item?.type && !steam ? String(item.type) : (steam?.type || ''),
        buy: num(item?.buy) || price,
        sell: num(item?.sell) || price
    }
}

/* ---------- Steam items saved without their description ---------- */

// 'classid_instanceid' -> { market_hash_name, icon_url, tags, descriptions } (null: Steam doesn't know it), from
// ISteamEconomy/GetAssetClassInfo. A class always looks the same, so what Steam said is kept.
const classes = new Map()
const CLASS_KEEP = 20000
const steam_state = { wait_until: 0 } // after a failed request Steam isn't asked again for a minute
const class_key = (item) => `${item.classid}_${item.instanceid || 0}`
const needs_class = (item) => is_object(item) && !is_site_item(item) && !pure_kind(item) && !bp_name(item) && !steam_name(item) && item.classid

const describe_classes = async (items) => {
    const wanted = [...new Set(items.filter(needs_class).map(class_key))].filter((k) => !classes.has(k))
    if (!wanted.length || !process.env.API_KEY_STEAM || Date.now() < steam_state.wait_until) { return }
    for (let i = 0; i < wanted.length; i += 100) {
        const chunk = wanted.slice(i, i + 100)
        const params = new URLSearchParams({ key: process.env.API_KEY_STEAM, appid: '440', language: 'en', class_count: String(chunk.length) })
        chunk.forEach((k, n) => {
            const [classid, instanceid] = k.split('_')
            params.set(`classid${n}`, classid)
            params.set(`instanceid${n}`, instanceid)
        })
        try {
            const res = await fetch(`https://api.steampowered.com/ISteamEconomy/GetAssetClassInfo/v1/?${params}`, { timeout: 10000 })
            const result = (await res.json())?.result
            if (!result?.success) { steam_state.wait_until = Date.now() + 60 * 1000; break }
            for (const k of chunk) {
                const [classid, instanceid] = k.split('_')
                const d = result[instanceid != '0' ? k : classid] || result[classid]
                classes.set(k, d?.market_hash_name ? {
                    market_hash_name: d.market_hash_name, icon_url: d.icon_url,
                    tags: Object.values(d.tags || {}), descriptions: Object.values(d.descriptions || {})
                } : null)
            }
        } catch (e) {
            console.log('trade records: Steam item descriptions failed', e.message)
            steam_state.wait_until = Date.now() + 60 * 1000
            break
        }
    }
    for (const k of classes.keys()) {
        if (classes.size <= CLASS_KEEP) { break }
        classes.delete(k)
    }
}

// the item with Steam's description added when it was saved without one
const described = (item) => needs_class(item) && classes.get(class_key(item)) ? { ...item, ...classes.get(class_key(item)) } : item

/* ---------- our item database ---------- */

// { by_bp: Map(bp_sku -> doc), effects: Map(effect name -> id) } for these copies (looked up by bp_sku, which is indexed)
const lookup = async (list) => {
    const names = [...new Set(list.flatMap((c) => c.names))].filter(Boolean)
    const effect_names = [...new Set(list.map((c) => c.effect).filter(Boolean))]
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

// buy / sell of one copy: its killstreak tier's prices when the item has them (left out when we have no price)
const prices = (doc, ks) => {
    const tier = ks > 0 ? (doc?.killstreak || []).find((k) => ks_tier(k?.kt ?? k?.ks_tier) == ks) : null
    const buy = num(tier?.buy) || num(doc?.buy)
    const sell = num(tier?.sell) || num(doc?.sell)
    return { ...(buy > 0 ? { buy } : {}), ...(sell > 0 ? { sell } : {}) }
}

// the key price in ref now, for records that don't say what it was (cached for 10 minutes)
const key_cache = { value: 0, at: 0 }
const key_price_now = async () => {
    if (Date.now() - key_cache.at > 10 * 60 * 1000) {
        const pure = await pure_model.findOne({ name: 'Mann Co. Supply Crate Key' }, { value_raw: 1 }).lean().catch(() => null)
        Object.assign(key_cache, { value: num(pure?.value_raw), at: Date.now() })
    }
    return key_cache.value
}

/* ---------- records ---------- */

const side_list = (side) => Array.isArray(side) ? side : Array.isArray(side?.items) ? side.items : []
const has_content = (side) => side_list(side).length > 0 || ['keys', 'ref', 'rec', 'scrap', 'metal'].some((k) => num(side?.[k]) > 0)
// the first of these sides that has something on it
const first_side = (...sides) => sides.find(has_content) ?? sides.find((s) => s != null) ?? null
// the two sides of a record as saved: { give, receive }
const raw_sides = (record) => ({
    give: first_side(record?.toGive, record?.itemsToGive),
    receive: first_side(record?.toReceive, record?.itemsToReceive)
})
// a Steam ID as text, also from a SteamID object ({ accountid, ... })
const steamid_of = (v) => (is_object(v) && Number.isFinite(Number(v.accountid))) ? String(76561197960265728n + BigInt(Math.floor(Number(v.accountid)))) : v

// one side as { keys, ref, rec, scrap, items, unknown }; unknown counts the items nothing could be read from
const read_side = (side, found) => {
    // metal: all metal in ref, for records that don't count ref, rec and scrap apart
    const apart = ['ref', 'rec', 'scrap'].some((k) => side?.[k] != null)
    const out = { keys: num(side?.keys), ref: apart ? num(side?.ref) : num(side?.metal), rec: num(side?.rec), scrap: num(side?.scrap), items: [], unknown: 0 }
    const grouped = new Map()
    for (const raw of side_list(side)) {
        const item = described(raw)
        const pure = pure_kind(item)
        if (pure) { out[pure] += amount(item); continue }
        if (is_site_item(item)) { out.items.push(item); continue }
        const c = is_object(item) || typeof item == 'string' ? copies_of(typeof item == 'string' ? { bp_sku: item } : item) : null
        if (!c) { out.unknown++; continue }

        const doc = c.names.map((name) => found.by_bp.get(name)).find(Boolean) || null
        const entry = {
            bp_sku: doc?.bp_sku || c.names[0],
            qualityID: String(doc?.qualityID ?? c.quality ?? 6),
            effectID: num(doc?.effectID) || c.effectID || found.effects.get(c.effect) || 0,
            type: doc?.type || c.type,
            image: doc?.image || c.image
        }
        const key = `${entry.bp_sku}|${entry.qualityID}|${entry.effectID}`
        if (!grouped.has(key)) { grouped.set(key, { ...entry, user_stock: [] }) }
        const own = { ...(c.buy > 0 ? { buy: c.buy } : {}), ...(c.sell > 0 ? { sell: c.sell } : {}) }
        for (const a of c.assetids) {
            grouped.get(key).user_stock.push({ a, ks: c.ks, f: c.f, ...prices(doc, c.ks), ...own })
        }
    }
    out.items.push(...grouped.values())
    return out
}

// Records of any layout -> [{ _id, tradeID, partnerSteamID, bot, timestamp (ms), key_value, internalTrade, toGive,
// toReceive, incomplete }]. incomplete: some item couldn't be read (no name, and Steam didn't describe it), so the trade
// can't be drawn whole.
const site_shape = async (records) => {
    const all_items = records.flatMap((r) => { const s = raw_sides(r); return [...side_list(s.give), ...side_list(s.receive)] })
    await describe_classes(all_items)
    const copies = all_items.map(described)
        .filter((item) => !pure_kind(item) && !is_site_item(item))
        .map((item) => typeof item == 'string' ? copies_of({ bp_sku: item }) : is_object(item) ? copies_of(item) : null)
        .filter(Boolean)
    const found = await lookup(copies)
    const key_now = records.some((r) => !(num(r?.key_value) || num(r?.key_price))) ? await key_price_now() : 0

    return records.map((record) => {
        const sides = raw_sides(record)
        const toGive = read_side(sides.give, found)
        const toReceive = read_side(sides.receive, found)
        const incomplete = toGive.unknown + toReceive.unknown > 0
        delete toGive.unknown
        delete toReceive.unknown
        return {
            _id: record._id,
            tradeID: record.tradeID ?? record.offerID ?? record.offer_id,
            partnerSteamID: steamid_of(record.partnerSteamID ?? record.partner),
            bot: record.bot,
            timestamp: record_time(record),
            key_value: num(record.key_value) || num(record.key_price) || key_now || undefined,
            internalTrade: record.internalTrade === true,
            toGive, toReceive, incomplete
        }
    })
}

// How a record was saved, in words, for Admin -> Trade records: "itemsToGive: 2 bp_sku items; itemsToReceive: 3 key / metal items"
const KINDS = {
    site: ['site item', 'site items'], pure: ['key / metal item', 'key / metal items'], text: ['bp_sku text', 'bp_sku texts'],
    bp: ['bp_sku item', 'bp_sku items'], steam: ['Steam item', 'Steam items'],
    described: ['Steam item without a description (Steam described it)', 'Steam items without a description (Steam described them)'],
    undescribed: ["Steam item without a description (Steam didn't describe it)", "Steam items without a description (Steam didn't describe them)"],
    nameless: ['item without a name', 'items without a name'], other: ['unreadable entry', 'unreadable entries']
}
const PURE_WORDS = { keys: ['key', 'keys'], ref: ['ref', 'ref'], rec: ['rec', 'rec'], scrap: ['scrap', 'scrap'], metal: ['metal in ref', 'metal in ref'] }
const counted = (n, [one, more]) => `${n} ${n == 1 ? one : more}`
const layout = (record) => {
    const kind = (item) => is_site_item(item) ? 'site' : pure_kind(item) ? 'pure' : typeof item == 'string' ? 'text' : !is_object(item) ? 'other'
        : bp_name(item) ? 'bp' : steam_name(item) ? 'steam' : needs_class(item) ? (classes.get(class_key(item)) ? 'described' : 'undescribed') : 'nameless'
    const sides = [['toGive', record?.toGive], ['toReceive', record?.toReceive], ['itemsToGive', record?.itemsToGive], ['itemsToReceive', record?.itemsToReceive]]
        .filter(([, side]) => side != null)
        .map(([field, side]) => {
            const counts = new Map()
            for (const item of side_list(side)) { counts.set(kind(item), (counts.get(kind(item)) || 0) + 1) }
            const pure = Array.isArray(side) ? [] : Object.keys(PURE_WORDS).filter((k) => num(side?.[k]) > 0).map((k) => counted(num(side[k]), PURE_WORDS[k]))
            const parts = [...[...counts].map(([k, n]) => counted(n, KINDS[k])), ...pure]
            return `${field}: ${parts.length ? parts.join(', ') : 'empty'}`
        })
    return sides.length ? sides.join('; ') : 'no toGive / toReceive / itemsToGive / itemsToReceive field'
}

export { site_shape, to_ms, parse, bp_names, record_time, layout }
