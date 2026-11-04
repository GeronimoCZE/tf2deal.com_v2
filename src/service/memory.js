// Gives memory the site no longer uses back to the server.
//
// What the site keeps is small (about 60 MB with 48,000 items: the item list, templates, translations), but every
// minute it also reads the item list again, and every page view, search engine visit and API answer leaves garbage
// behind. Node (V8) cleans that up, yet keeps the freed memory for later instead of returning it, so after a busy
// stretch PM2 showed 400-600 MB for a site that held a tenth of that. With the heap cap of ecosystem.config.cjs the
// peaks are lower, but the memory still isn't given back.
//
// Every minute this looks at the memory PM2 shows (RSS). When it is TIDY_ABOVE MB over what the last tidy left (and
// the last tidy was at least MIN_GAP ago), it runs V8's most thorough garbage collection, the one that also returns
// the freed memory to the system. That takes a few tenths of a second, during which the site waits; the log says
// "Memory: ... MB -> ... MB" each time.

import v8 from 'v8'
import vm from 'vm'

const CHECK_EVERY = 60 * 1000
const MIN_GAP = 5 * 60 * 1000
const TIDY_ABOVE = 48  // MB over what the last tidy left
const FIRST_FLOOR = 140 // MB: what the site needs right after the start, before the first tidy says better

const mb = (bytes) => Math.round(bytes / 1048576)

let gc = null
try {
    v8.setFlagsFromString('--expose-gc')
    gc = vm.runInNewContext('gc')
} catch (error) {
    gc = null
}

export const state = { floor: FIRST_FLOOR, last: 0, count: 0, took_ms: 0 }

// one thorough clean-up now; { before, after, took } in MB / ms, or null without access to V8's gc
export const tidy = () => {
    if (!gc) return null
    const before = mb(process.memoryUsage().rss)
    const began = Date.now()
    // 'last-resort' also hands the freed pages back to the system (an ordinary full gc keeps them);
    // an older Node without this option does an ordinary full gc instead
    gc({ type: 'major', execution: 'sync', flavor: 'last-resort' })
    const after = mb(process.memoryUsage().rss)
    Object.assign(state, { floor: after, last: Date.now(), count: state.count + 1, took_ms: Date.now() - began })
    return { before, after, took: state.took_ms }
}

const check = () => {
    const rss = mb(process.memoryUsage().rss)
    if (rss < state.floor + TIDY_ABOVE || Date.now() - state.last < MIN_GAP) return
    const result = tidy()
    if (result) console.log(`Memory: ${result.before} MB -> ${result.after} MB (${mb(process.memoryUsage().heapUsed)} MB in use, cleaned up in ${result.took} ms)`)
}

// for Admin -> Overview: what PM2 shows (rss), what the site holds (heap_used), the heap cap and the last clean-up
export const summary = () => {
    const m = process.memoryUsage()
    const limit = mb(v8.getHeapStatistics().heap_size_limit)
    return { rss: mb(m.rss), heap_used: mb(m.heapUsed), heap_limit: limit, capped: limit <= 1024, tidies: state.count, last_tidy: state.last || null }
}

export const start = () => {
    const limit = mb(v8.getHeapStatistics().heap_size_limit)
    console.log(`Memory: ${mb(process.memoryUsage().rss)} MB at the start, heap limit ${limit} MB${gc ? '' : ', clean-ups off (no access to V8\'s gc)'}`)
    // without the cap of ecosystem.config.cjs Node's own limit is about 2 GB (or a quarter of the server's memory)
    if (limit > 1024) console.log('Memory: started without the heap cap. Start the site with `pm2 start ecosystem.config.cjs` (docs/UBUNTU.md) so it stays smaller.')
    if (gc) setInterval(check, CHECK_EVERY).unref()
}
