// Category pages of the item list (routes/router.js items): /items?quality=Unusual, /items?type=Taunt,
// /items?class=Scout, ... The addresses are the ones the item filters already use (public/js/plugins/items.js reads
// them, the home page links to some), so the filters and the scrolling list keep working on them.
// Each category is a page of its own for search engines: its own title, heading, description and canonical address,
// and the server sends its items in the HTML. Any other mix of filters is the plain item list (canonical /items).
// Category names are TF2 words and stay English on every language version, like the item names.

const CLASSES = ['Scout', 'Soldier', 'Pyro', 'Demoman', 'Heavy', 'Engineer', 'Medic', 'Sniper', 'Spy']

// the item list's quality filter (public/js and api/routes/items.js use the same names)
export const QUALITY_IDS = {
  Normal: 0, Genuine: 1, Vintage: 3, Unusual: 5, Unique: 6, Community: 7, Valve: 8, 'Self-Made': 9, Strange: 11,
  Haunted: 13, "Collector's": 14, Decorated: 15
}

export const CATEGORIES = [
  { param: 'quality', value: 'Unusual', name: 'Unusuals' },
  { param: 'quality', value: 'Strange', name: 'Strange Items' },
  { param: 'quality', value: 'Vintage', name: 'Vintage Items' },
  { param: 'quality', value: 'Genuine', name: 'Genuine Items' },
  { param: 'quality', value: 'Haunted', name: 'Haunted Items' },
  { param: 'quality', value: "Collector's", name: "Collector's Items" },
  { param: 'quality', value: 'Decorated', name: 'Weapon Skins' },
  { param: 'type', value: 'Cosmetic', name: 'Cosmetics' },
  { param: 'type', value: 'Taunt', name: 'Taunts' },
  { param: 'type', value: 'War Paint', name: 'War Paints' },
  { param: 'type', value: 'Tool', name: 'Tools' },
  { param: 'type', value: 'Crate', name: 'Crates and Cases' },
  ...CLASSES.map((value) => ({ param: 'class', value, name: `${value} Items` }))
]

// the address of a category: "/items?quality=Unusual" (without the language; req.lurl adds it)
export const path_of = (category, page = 1) => {
  const query = new URLSearchParams({ [category.param]: category.value })
  if (page > 1) query.set('page', String(page))
  return `/items?${query.toString()}`
}

// the category an item list address is, or null: exactly one filter (and maybe ?page=), naming a category
export const from_query = (query) => {
  const keys = [...query.keys()].filter((key) => key !== 'page')
  if (keys.length !== 1 || query.getAll(keys[0]).length !== 1) return null
  return CATEGORIES.find((c) => c.param === keys[0] && c.value === query.get(keys[0])) || null
}

// The item list's own filter values (views/items.ejs dropdowns; the page checks a value from the address against them),
// for the links on an item page: its quality, type and classes open the list with that filter.
const LIST_QUALITIES = ['Unique', 'Strange', 'Unusual', 'Vintage', 'Genuine', 'Haunted', "Collector's", 'Decorated']
const LIST_TYPES = ['Cosmetic', 'Taunt', 'Weapon Primary', 'Weapon Secondary', 'Weapon Melee', 'Weapon PDA2', 'Weapon Building', 'Action', 'Crate']
export const list_links = (item) => {
  const link = (param, value) => `/items?${new URLSearchParams({ [param]: value }).toString()}`
  const quality = Object.keys(QUALITY_IDS).find((name) => QUALITY_IDS[name] === Number(item?.qualityID))
  const type = String(item?.type || '').toLowerCase().replace(/^australium /, '')
  const type_value = type === 'warpaint' ? 'War Paint'
    : type.startsWith('tool') ? 'Tool'
    : LIST_TYPES.find((value) => type === value.toLowerCase() || type.startsWith(value.toLowerCase() + ' skin'))
  const classes = (Array.isArray(item?.classes) ? item.classes : String(item?.classes || '').split(',')).map((c) => String(c).trim()).filter(Boolean)
  return {
    quality: LIST_QUALITIES.includes(quality) ? link('quality', quality) : null,
    type: type_value ? link('type', type_value) : null,
    // one link per class; an item for all nine classes has none (the list would show nearly everything)
    classes: classes.length < CLASSES.length ? Object.fromEntries(classes.filter((c) => CLASSES.includes(c)).map((c) => [c, link('class', c)])) : {}
  }
}

// item list filters (service/item_lists.js cards) from the address, as /api/items reads them from its request
export const filters_of = (query) => {
  const text = (key) => {
    const value = query.get(key)
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined
  }
  const quality = text('quality')
  const clas = text('class')
  return {
    ...(text('name') !== undefined && { name: text('name') }),
    ...(quality !== undefined && QUALITY_IDS[quality] !== undefined && { qualityID: String(QUALITY_IDS[quality]) }),
    ...(text('type') !== undefined && { type: text('type') }),
    ...(clas !== undefined && clas !== 'All Classes' && { classes: clas.split(',').map((c) => c.trim()).filter(Boolean) }),
    ...(['Can sell', 'Can buy'].includes(text('stock')) && { stock: text('stock') })
  }
}
