// Professional Killstreak combos: good ones at the item's price, bad ones for less (docs/KS_COMBOS.md)
//
// Nikolas 2026-11-25: a simplified Professional Killstreak tier list from the backpack.tf forum's chart, in two
// categories: good sheen + killstreaker combos at the price we pay now, bad combos for less. item_manager owns the table
// and the prices; this file only reads them, on the item page and the trade page (js/plugins/trade.js) and on the
// server (service/buy_link.js). It imports nothing and touches no page, so both can load it.
//
//                       TS   VV   HR   M    AE   DD   MG
//   Fire Horns   FH     good good good good good good good
//   Tornado      T      good good good good bad  bad  bad
//   Flames       F      good good bad  good bad  bad  bad
//   Incinerator  I      good bad  bad  bad  bad  bad  bad
//   Singularity  S      good bad  bad  bad  bad  bad  bad
//   Cerebral D.  CD     good bad  bad  bad  bad  bad  bad
//   Hypno-Beam   HB     bad  bad  bad  bad  bad  bad  bad
//
// Where the prices are (in ref, or { key, metal }):
//   - a weapon's Professional Killstreak tier: its item.killstreak entry { kt: 3, ..., low_end_sell, low_end_buy, bad_combos }
//   - a Professional Killstreak Kit / Kit Fabricator: item.combo_price { low_end_sell, low_end_buy, bad_combos }
// bad_combos are codes "<sheen>+<killstreaker>" in initials ("VV+CD"), as the bots' backpack.tf listings name them.
// low_end_buy 0: bad combos aren't bought. The bot server marks every copy that is a bad combo (bad_combo: true) and
// sends its own, lower price with it.

// Steam's names, in the chart's order, with the initials
export const SHEENS = [
    { name: 'Team Shine', code: 'TS' },
    { name: 'Villainous Violet', code: 'VV' },
    { name: 'Hot Rod', code: 'HR' },
    { name: 'Manndarin', code: 'M' },
    { name: 'Agonizing Emerald', code: 'AE' },
    { name: 'Deadly Daffodil', code: 'DD' },
    { name: 'Mean Green', code: 'MG' }
]
export const KILLSTREAKERS = [
    { name: 'Fire Horns', code: 'FH' },
    { name: 'Tornado', code: 'T' },
    { name: 'Flames', code: 'F' },
    { name: 'Incinerator', code: 'I' },
    { name: 'Singularity', code: 'S' },
    { name: 'Cerebral Discharge', code: 'CD' },
    { name: 'Hypno-Beam', code: 'HB' }
]

// every combo, best killstreaker first, then the sheens in the chart's order
export const ALL = KILLSTREAKERS.flatMap((k) => SHEENS.map((s) => `${s.code}+${k.code}`))
const KNOWN = new Set(ALL)

const plain = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const first = (v) => (Array.isArray(v) ? v : [v]).find((t) => typeof t == 'string' && t.trim()) || ''
const lookup = (list) => new Map(list.flatMap((e) => [[plain(e.name), e.code], [plain(e.code), e.code]]))
const SHEEN_KEYS = lookup(SHEENS)
const KS_KEYS = lookup(KILLSTREAKERS)
KS_KEYS.set('hypnobeams', 'HB')

/** a copy's combo ("TS+FH") from its Steam description (asset.at.sheen / at.killstreaker), null without both */
export const of = (asset) => {
    const s = SHEEN_KEYS.get(plain(first(asset?.at?.sheen)).replace(/^sheen/, ''))
    const k = KS_KEYS.get(plain(first(asset?.at?.killstreaker)).replace(/^killstreaker/, ''))
    return s && k ? `${s}+${k}` : null
}

/** a list of codes as item_manager writes them → the known ones, upper case, no repeats */
export const codes = (list) => Array.isArray(list)
    ? [...new Set(list.map((c) => String(c ?? '').trim().toUpperCase()).filter((c) => KNOWN.has(c)))] : []

/** "VV+CD" → "Villainous Violet + Cerebral Discharge" */
export const name = (code) => {
    const [s, k] = String(code ?? '').split('+')
    const sheen = SHEENS.find((e) => e.code == s), ks = KILLSTREAKERS.find((e) => e.code == k)
    return sheen && ks ? `${sheen.name} + ${ks.name}` : String(code ?? '')
}

const PRO_KIT = /^(?:Non-Craftable\s+)?Professional Killstreak (?:.+ )?Kit(?: Fabricator)?$/i
/** a Professional Killstreak Kit or Kit Fabricator, by its name */
export const is_pro_kit = (bp_sku) => PRO_KIT.test(String(bp_sku ?? '').trim())

const tier_of = (entry) => {
    const v = entry?.ks_tier ?? entry?.kt ?? entry?.tier
    if (!isNaN(Number(v))) return Number(v)
    return String(v ?? '').trim().toLowerCase().startsWith('pro') ? 3 : 0
}
const ref_of = (value, key_ref) => {
    if (value && typeof value == 'object') {
        const ref = (Number(value.key) || 0) * (Number(key_ref) || 0) + (Number(value.metal) || 0)
        return ref > 0 ? ref : 0
    }
    return Number(value) > 0 ? Number(value) : 0
}

/**
 * The bad combo price of an item: of its Professional Killstreak tier (a weapon) or of the item (a Professional
 * Killstreak Kit / Kit Fabricator): { bad: [codes], sell, buy } in ref (buy 0: bad combos aren't bought), null when it
 * has none. key_ref: the key price in ref, for prices written as { key, metal }.
 */
export const price_of = (doc, key_ref = 0) => {
    if (!doc) return null
    let raw = null
    if (is_pro_kit(doc.bp_sku)) {
        raw = doc.combo_price
    } else {
        const list = Array.isArray(doc.killstreak) ? doc.killstreak : (doc.killstreak?.killstreaks || [])
        raw = list.find((entry) => tier_of(entry) == 3) || null
    }
    const bad = codes(raw?.bad_combos)
    const sell = ref_of(raw?.low_end_sell, key_ref)
    if (!bad.length || !(sell > 0)) return null
    return { bad, sell, buy: ref_of(raw?.low_end_buy, key_ref) }
}

/** does a copy of this item get the bad combo price? (a Professional Killstreak copy or a Kit / Kit Fabricator) */
export const is_bad = (doc, asset, key_ref = 0) => {
    if (asset?.bad_combo === true) return true
    if (!is_pro_kit(doc?.bp_sku) && Number(asset?.ks) != 3) return false
    const price = price_of(doc, key_ref)
    const code = of(asset)
    return !!price && !!code && price.bad.includes(code)
}
