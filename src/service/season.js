// Seasonal look during the TF2 events: Summer, Scream Fortress (Halloween) and Smissmas.
//
// The event and its end date come from the official update notes on teamfortress.com, e.g.
// "Scream Fortress XVIII runs through November 7th, 2026" in the post of October 1, 2026 (the post date is the start).
// The page is read at most every 6 hours. If it can't be read, or this year's event isn't announced there yet,
// the usual dates below are used instead. Outside an event the site keeps its normal look.
//
// The admin panel (Live settings → Seasonal theme) can force a theme or turn it off: settings.season is
// 'auto' (default), 'off', 'summer', 'halloween' or 'smissmas'.
//
//   current()  { id: 'halloween' | 'summer' | 'smissmas' | null, name, ends, source }
//   status()   the same plus what was read from teamfortress.com (for the admin panel)

import * as settings from './settings.js'

export const SEASONS = {
  summer: { name: 'Summer event', match: /summer/i },
  halloween: { name: 'Scream Fortress', match: /scream\s*fortress|halloween/i },
  smissmas: { name: 'Smissmas', match: /smissmas|christmas/i }
}
export const CHOICES = ['auto', 'off', ...Object.keys(SEASONS)]

// usual dates (month is 1-12, end day inclusive); used when the official page has nothing for this year
const CALENDAR = [
  { id: 'summer', from: [7, 1], to: [9, 15] },
  { id: 'halloween', from: [10, 1], to: [11, 10] },
  { id: 'smissmas', from: [12, 1], to: [1, 7] } // runs into January
]

const SOURCE_URLS = ['https://www.teamfortress.com/?tab=updates']
const REFRESH_MS = 6 * 60 * 60 * 1000
const RETRY_MS = 30 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DATE = '([A-Z][a-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})'

const parse_date = (month, day, year) => {
  const m = MONTHS.indexOf(String(month).toLowerCase())
  if (m < 0) { return null }
  const t = Date.UTC(Number(year), m, Number(day))
  return Number.isFinite(t) ? t : null
}

const to_text = (html) => String(html)
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ')

// Finds "<event> ... runs through <date>" in the update notes. The post's own date ("October 1, 2026 - TF2 Team")
// comes before it and is taken as the start of the event.
export const parse_updates = (html) => {
  const text = to_text(html)
  const dates = [...text.matchAll(new RegExp(DATE, 'g'))]
    .map((m) => ({ at: m.index, t: parse_date(m[1], m[2], m[3]) }))
    .filter((d) => d.t)
  const events = []
  for (const m of text.matchAll(new RegExp(`([^.\\n]{0,80}?)\\b(?:runs|lasts|continues)\\s+(?:through|until|till)\\s+${DATE}`, 'gi'))) {
    const id = Object.keys(SEASONS).find((k) => SEASONS[k].match.test(m[1]))
    const end = parse_date(m[2], m[3], m[4])
    // the latest date written before the sentence, within ~3 months before the end
    const start = dates.filter((d) => d.at < m.index && d.t < end && end - d.t < 100 * DAY).pop()?.t
    if (id && start && end) {
      const title = m[1].trim().replace(/^the\s+/i, '')
      if (!events.some((e) => e.id == id && e.end == end + DAY - 1)) {
        events.push({ id, title: title.length <= 40 ? title : SEASONS[id].name, start, end: end + DAY - 1 })
      }
    }
  }
  return events
}

const state = { events: [], fetched: 0, ok: false, error: '', next: 0, loading: null }

const refresh = async () => {
  const found = []
  for (const url of SOURCE_URLS) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tf2deal.com season check)' } })
    if (!res.ok) { throw new Error(`${url} answered ${res.status}`) }
    found.push(...parse_updates(await res.text()))
  }
  state.events = found
  state.ok = true
  state.error = ''
  state.fetched = Date.now()
  state.next = Date.now() + REFRESH_MS
}

// called on every check; starts a background refresh when due (never blocks a page)
const maybe_refresh = () => {
  if (state.loading || Date.now() < state.next || typeof fetch != 'function') { return }
  state.loading = refresh()
    .catch((error) => {
      state.ok = false
      state.error = error?.message || String(error)
      state.next = Date.now() + RETRY_MS
      console.error('Season check: could not read teamfortress.com:', state.error)
    })
    .finally(() => { state.loading = null })
}

const in_calendar = (entry, now) => {
  const d = new Date(now)
  const y = d.getUTCFullYear()
  const md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
  const from = entry.from[0] * 100 + entry.from[1]
  const to = entry.to[0] * 100 + entry.to[1]
  if (from <= to) {
    return md >= from && md <= to ? { start: Date.UTC(y, entry.from[0] - 1, entry.from[1]), end: Date.UTC(y, entry.to[0] - 1, entry.to[1]) + DAY - 1 } : null
  }
  if (md >= from) { return { start: Date.UTC(y, entry.from[0] - 1, entry.from[1]), end: Date.UTC(y + 1, entry.to[0] - 1, entry.to[1]) + DAY - 1 } }
  if (md <= to) { return { start: Date.UTC(y - 1, entry.from[0] - 1, entry.from[1]), end: Date.UTC(y, entry.to[0] - 1, entry.to[1]) + DAY - 1 } }
  return null
}

// The event running at `now`: an announced one wins; the calendar fills in only for an event type
// that has no announcement for this year yet (so an event that ended early is not stretched).
export const detect = (now = Date.now(), events = state.events) => {
  const live = events.find((e) => e.start <= now && now <= e.end)
  if (live) { return { id: live.id, name: live.title || SEASONS[live.id].name, ends: live.end, source: 'teamfortress.com' } }
  for (const entry of CALENDAR) {
    const window = in_calendar(entry, now)
    if (!window) { continue }
    // announced this year (start within ~4 months) but not running now: it is over or not started
    const announced = events.some((e) => e.id == entry.id && Math.abs(e.start - window.start) < 120 * DAY)
    if (announced) { continue }
    return { id: entry.id, name: SEASONS[entry.id].name, ends: window.end, source: 'usual dates' }
  }
  return { id: null, name: '', ends: null, source: '' }
}

export const current = (now = Date.now()) => {
  const choice = settings.get().season || 'auto'
  if (choice == 'off') { return { id: null, name: '', ends: null, source: 'turned off in the admin panel' } }
  if (SEASONS[choice]) { return { id: choice, name: SEASONS[choice].name, ends: null, source: 'set in the admin panel' } }
  maybe_refresh()
  return detect(now)
}

export const status = () => ({
  choice: settings.get().season || 'auto',
  detected: detect(),
  active: current(),
  source: { ok: state.ok, fetched: state.fetched, error: state.error, events: state.events.slice(0, 6) }
})

// the class on <body>: '' outside events
export const body_class = () => {
  const s = current()
  return s.id ? `season-${s.id}` : ''
}

export const start = () => { maybe_refresh() }
