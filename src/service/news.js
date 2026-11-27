// What's new on the site, newest first. This list is the record of the site's features: nothing is typed into the
// admin panel. A pull request that adds something visitors can use puts its entry at the top of NEWS, in that same
// pull request, so the news goes live together with the feature (`git pull` + restart). How: docs/NEWS.md.
// Every entry is listed on the updates page (/news, views/news.ejs); giveaways and blog posts are not features and
// have their own pages.
//
//   { key, date: 'YYYY-MM-DD', href | action, image, window, requires }
//
//   key     letters a-z, digits and _. Its texts are under news.items.<key> in every locales/<lang>.json:
//             title, text    every entry: the headline and two or three sentences on what it is (the updates page;
//                            the title is also its line in the welcome window's "What's new")
//             button         entries with window: true
//   date    the day the feature goes live. An entry dated later than today waits for its day. The time of day is
//           written down by the site itself: the moment its server first runs with the entry out
//           (service/news_times.js), which the updates page shows. 'YYYY-MM-DD HH:MM' (UTC) sets the time instead;
//           the entries from before the updates page carry the time their pull request was merged.
//   href    the page the button (and the "What's new" line) opens: a site path like /items, the language is added
//   action  instead of href, something the button does on the page (public/js/welcome.js ACTIONS):
//             'themes'     opens the language and theme window
//             'assistant'  opens the chat helper
//   requires  for a feature the admin switches on: the entry is out only while conditions[requires]() is true
//           (service/assistant.js sets conditions.assistant: the chat helper is on and has an API key). Its time is
//           written down the first time it's out, so /news says when visitors really got it.
//   image   a picture in public/img/news/: <image>-1200.webp (1200 x 500) and <image>-640.webp (640 x 267)
//   window  true for a big feature. The newest entry with window: true is shown once, in the news window, to every
//           visitor who hasn't seen it yet (public/js/welcome.js, views/partials/news_modal.ejs). A newer one takes
//           its place: only the latest is ever shown. Smaller changes leave it out and get just their line in
//           "What's new" and on the updates page.
//
// `npm test` (scripts/check.mjs) checks the list: unique keys, newest first, texts in all 8 languages, pictures.
// This file imports nothing, so the check can read it without starting the site.

export const NEWS = [
  { key: 'assistant', date: '2026-11-27', action: 'assistant', requires: 'assistant', window: true },
  { key: 'today_trades', date: '2026-11-27', href: '/' },
  { key: 'giveaway_share', date: '2026-11-26', href: '/giveaway' },
  { key: 'ks_combos', date: '2026-11-25', href: '/items' },
  { key: 'key_bank', date: '2026-11-25', href: '/keys' },
  { key: 'trade_details', date: '2026-11-25', href: '/' },
  { key: 'fabricators', date: '2026-11-20', href: '/items' },
  { key: 'lamplight', date: '2026-11-19', action: 'themes', image: 'lamplight', window: true },
  { key: 'quality_glow', date: '2026-11-19', href: '/items' },
  { key: 'nebula', date: '2026-11-18', action: 'themes', image: 'nebula', window: true },
  { key: 'updates_page', date: '2026-11-15', href: '/news' },
  { key: 'themes', date: '2026-11-03 21:20', action: 'themes', image: 'themes', window: true },
  { key: 'collections', date: '2026-11-03 16:01', href: '/items' },
  { key: 'killstreak', date: '2026-11-02 15:37', href: '/items' },
  { key: 'item_details', date: '2026-10-28 18:15', href: '/trade' }
]

export const ACTIONS = ['themes', 'assistant']

// the features an entry can wait for (`requires`): each one fills in conditions[<name>] when it starts
export const REQUIRES = ['assistant']

// requires -> () => true while that feature is on (filled in by the services that own them; empty for npm test)
export const conditions = {}
const ready = (entry) => !entry.requires || conditions[entry.requires]?.() === true

export const DATE = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/

// true when the entry's date carries its time of day ('YYYY-MM-DD HH:MM')
export const exact = (entry) => Boolean(DATE.exec(entry?.date || '')?.[2])

// the start of the entry's day (UTC), in ms
export const day = (entry) => Date.parse(`${DATE.exec(entry?.date || '')?.[1]}T00:00:00Z`) || 0

// when the entry is out, in ms: its time if the date has one, else the start of its day (UTC)
export const time = (entry) => {
  const [, date, at] = DATE.exec(entry?.date || '') || []
  return (date && Date.parse(`${date}T${at || '00:00'}:00Z`)) || 0
}

// the entries that are out (dated now or earlier), newest first
export const published = (now = Date.now()) => NEWS.filter((entry) => time(entry) <= now && ready(entry))

// the news window's entry: the newest published one with window: true, or null
export const live = (now = Date.now()) => NEWS.find((entry) => entry.window && time(entry) <= now && ready(entry)) || null

export const find = (key) => NEWS.find((entry) => entry.key === key) || null

// true when someone who has seen `seen` has seen `key` too: the same entry, or `seen` is newer (higher in the list).
// An unknown or empty `seen` covers nothing.
export const covers = (seen, key) => {
  const a = NEWS.findIndex((entry) => entry.key === seen)
  const b = NEWS.findIndex((entry) => entry.key === key)
  return a !== -1 && b !== -1 && a <= b
}
