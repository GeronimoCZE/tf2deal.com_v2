// What's new on the site, newest first. This list is the record of the site's features: nothing is typed into the
// admin panel. A pull request that adds something visitors can use puts its entry at the top of NEWS, in that same
// pull request, so the news goes live together with the feature (`git pull` + restart). How: docs/NEWS.md.
//
//   { key, date: 'YYYY-MM-DD', href | action, image, window }
//
//   key     letters a-z, digits and _. Its texts are under news.items.<key> in every locales/<lang>.json:
//             title          every entry (also its line in the welcome window's "What's new")
//             text, button   entries with window: true
//   date    the day the feature went live. An entry dated later than today waits for its day.
//   href    the page the button (and the "What's new" line) opens: a site path like /items, the language is added
//   action  instead of href, something the button does on the page (public/js/welcome.js ACTIONS):
//             'themes'  opens the language and theme window
//   image   a picture in public/img/news/: <image>-1200.webp (1200 x 500) and <image>-640.webp (640 x 267)
//   window  true for a big feature. The newest entry with window: true is shown once, in the news window, to every
//           visitor who hasn't seen it yet (public/js/welcome.js, views/partials/news_modal.ejs). A newer one takes
//           its place: only the latest is ever shown. Smaller changes leave it out and get just their line in
//           "What's new".
//
// `npm test` (scripts/check.mjs) checks the list: unique keys, newest first, texts in all 8 languages, pictures.
// This file imports nothing, so the check can read it without starting the site.

export const NEWS = [
  { key: 'themes', date: '2026-11-03', action: 'themes', image: 'themes', window: true },
  { key: 'collections', date: '2026-11-03', href: '/items' },
  { key: 'killstreak', date: '2026-11-02', href: '/items' },
  { key: 'item_details', date: '2026-10-28', href: '/trade' }
]

export const ACTIONS = ['themes']

// the start of the entry's day (UTC), in ms
export const time = (entry) => Date.parse(`${entry?.date}T00:00:00Z`) || 0

// the entries that are out (dated today or earlier), newest first
export const published = (now = Date.now()) => NEWS.filter((entry) => time(entry) <= now)

// the news window's entry: the newest published one with window: true, or null
export const live = (now = Date.now()) => NEWS.find((entry) => entry.window && time(entry) <= now) || null

export const find = (key) => NEWS.find((entry) => entry.key === key) || null

// true when someone who has seen `seen` has seen `key` too: the same entry, or `seen` is newer (higher in the list).
// An unknown or empty `seen` covers nothing.
export const covers = (seen, key) => {
  const a = NEWS.findIndex((entry) => entry.key === seen)
  const b = NEWS.findIndex((entry) => entry.key === key)
  return a !== -1 && b !== -1 && a <= b
}
