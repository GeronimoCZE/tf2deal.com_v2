// An item's price page on backpack.tf: https://backpack.tf/stats/<quality>/<name>/Tradable/<Craftable|Non-Craftable>[/<priceindex>]
// The item page's backpack.tf button (views/item_page.ejs) and the item window's link (/api/backpack_tf, which
// public/js/plugins/item_info.js opens) both come from here.
//
// The priceindex picks one version of an item, as backpack.tf names them:
//   unusual items, war paints, skins   the effect                /Unusual/Team Captain/.../13
//   crates and cases                   the series                /Unique/Mann Co. Supply Crate/.../30
//   Strangifiers                       the item it is for        /Unique/Strangifier/.../378
//   Unusualifiers                      the taunt it is for       /Unusual/Unusualifier/Tradable/Non-Craftable/1109
//   Killstreak Kits                    "<tier>-<weapon>"         /Unique/Professional Killstreak Kit/Tradable/Non-Craftable/3-205
//   Collector's Chemistry Sets         "<output>-14"            /Unique/Chemistry Set/Tradable/Non-Craftable/205-14
//   Kit Fabricators                    "<kit>-6-<weapon>"       /Unique/Professional Killstreak Fabricator/Tradable/Craftable/6526-6-317
//                                      (kit 6526 Professional, 6523 Specialized; Craftable unless the name says
//                                      Non-Craftable, like Chemistry Sets: item_manager names them as backpack.tf prices them)
// War paints and skins: "<paint> | <weapon> (<wear>)", Decorated Weapon quality (Strange ones: Strange).
// item_manager keeps the item a Strangifier, Unusualifier, Kit or Kit Fabricator is for, a Chemistry Set's output and a
// crate's series in item.priceindex, and a Chemistry Set's or Fabricator's backpack.tf name in item.name.

import * as fn from '../fn.js'

// what bptf_link needs of an item in the database
const FIELDS = { _id: 0, bp_sku: 1, name: 1, type: 1, qualityID: 1, craftable: 1, effectID: 1, priceindex: 1 }

const KS_NAMES = ['', 'Killstreak', 'Specialized Killstreak', 'Professional Killstreak']
// the weapon at the end of a war paint's or skin's name (item_manager's list, utils/skins.js)
const SKIN_WEAPONS = ['War Paint', 'Grenade Launcher', 'Shotgun', 'Revolver', 'Wrench', 'Sniper Rifle', 'Scattergun', 'Knife', 'Minigun', 'SMG', 'Rocket Launcher', 'Pistol', 'Medi Gun', 'Stickybomb Launcher', 'Flame Thrower']
const WEAR = /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle Scarred)\)/

const url = (quality, name, craftable, priceindex) =>
  `https://backpack.tf/stats/${encodeURIComponent(quality)}/${encodeURIComponent(name)}/Tradable/${craftable ? 'Craftable' : 'Non-Craftable'}` +
  (priceindex ? `/${encodeURIComponent(priceindex)}` : '')

// item: { bp_sku, name, type, qualityID, craftable, effectID, priceindex }; ks: a copy's killstreak tier (0-3);
// festivized: a festivized copy
const bptf_link = (item, { ks = 0, festivized = false } = {}) => {
  const sku = String(item?.bp_sku || '')
  const type = String(item?.type || '').toLowerCase()
  const name = String(item?.name || sku).replace(/^Non-Craftable /, '')
  const craftable = item?.craftable ? item.craftable !== 'Non-Craftable' : !sku.startsWith('Non-Craftable ')
  const quality = fn.quality_name(item?.qualityID) || 'Unique'
  const index = Number(item?.priceindex) > 0 ? Number(item.priceindex) : 0
  const effect = Number(item?.effectID) > 0 ? Number(item.effectID) : 0
  const prefix = [festivized ? 'Festivized' : '', KS_NAMES[Number(ks)] || ''].filter(Boolean).join(' ')
  const full = (base) => prefix ? `${prefix} ${base}` : base

  if (type == 'crate') {
    // "Mann Co. Supply Crate #30": series 30
    const series = index || Number(sku.match(/ #(\d+)$/)?.[1]) || 0
    return url(quality, name.replace(/ #\d+$/, ''), craftable, series)
  }
  if (type == 'tool strangifier') return url(quality, 'Strangifier', craftable, index)
  if (type == 'tool unusualifier') return url('Unusual', 'Unusualifier', false, index)
  if (type == 'tool kit') {
    // "Professional Killstreak Rocket Launcher Kit": tier 3
    const tier = [3, 2, 1].find((t) => name.includes(KS_NAMES[t] + ' ')) || 1
    return url(quality, `${KS_NAMES[tier]} Kit`, false, index ? `${tier}-${index}` : 0)
  }
  if (type == 'tool chemistry set') return url(quality, name, craftable, index ? `${index}-14` : 0)
  if (type == 'tool kit fabricator' || / Kit Fabricator$/.test(sku)) {
    // "Specialized Killstreak Rocket Launcher Kit Fabricator": kit 6523, backpack.tf's "Specialized Killstreak Fabricator"
    // (from the name, as item.name may be another spelling of it)
    const specialized = sku.includes('Specialized Killstreak ')
    return url('Unique', `${specialized ? 'Specialized' : 'Professional'} Killstreak Fabricator`, craftable, index ? `${specialized ? 6523 : 6526}-6-${index}` : 0)
  }
  if (type.includes('skin') || type.includes('warpaint')) {
    // "Warhawk Rocket Launcher (Field-Tested)" -> "Warhawk | Rocket Launcher (Field-Tested)"
    const wear = sku.match(WEAR)?.[0]
    const base = name.replace(WEAR, '').trim()
    const weapon = SKIN_WEAPONS.filter((w) => base.endsWith(' ' + w)).sort((a, b) => b.length - a.length)[0]
    const shown = (weapon ? `${base.slice(0, -weapon.length - 1)} | ${weapon}` : base) + (wear ? ' ' + wear : '')
    const strange = item?.qualityID == 11 || /^(Non-Craftable )?Strange /.test(sku)
    const skin_quality = item?.qualityID == 5 ? (strange ? 'Strange Decorated Weapon' : 'Decorated Weapon') : (strange ? 'Strange' : 'Decorated Weapon')
    return url(skin_quality, full(shown), craftable, effect)
  }
  return url(quality, full(name), craftable, effect || index)
}

// The item's TF2 Wiki page. Kits, Kit Fabricators and Chemistry Sets share one page each (the wiki has no page per
// weapon or output); every other item has the page of its name, as before.
const WIKI = 'https://wiki.teamfortress.com/wiki/'
const wiki_link = (item) => {
  const sku = String(item?.bp_sku || '')
  const type = String(item?.type || '').toLowerCase()
  if (type == 'tool kit fabricator' || / Kit Fabricator$/.test(sku)) return WIKI + 'Killstreak_Kit_Fabricator'
  if (type == 'tool chemistry set' || / Chemistry Set$/.test(sku)) return WIKI + 'Chemistry_Set'
  if (type == 'tool kit') return WIKI + 'Killstreak_Kit'
  return WIKI + encodeURIComponent(String(item?.name || ''))
}
// item types whose backpack.tf and wiki pages exist even without a backpack.tf community price (views/item_page.ejs)
const RECIPE_TYPES = ['tool kit fabricator', 'tool chemistry set']

export { bptf_link, wiki_link, RECIPE_TYPES, FIELDS }
