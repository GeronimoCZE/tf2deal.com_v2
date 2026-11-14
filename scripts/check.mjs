// `npm test`: a quick check that the site still builds, run by the "Node.js CI" GitHub workflow.
//   - every server and page script parses
//   - every page template compiles
//   - every language file is valid JSON (texts missing next to English are listed, they fall back to English)
//   - the stylesheet compiles
//   - every site news entry is complete (src/service/news.js, docs/NEWS.md)
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import ejs from 'ejs'
import * as sass from 'sass'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = (file) => path.relative(root, file)
const walk = (dir, exts) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name)
  if (entry.isDirectory()) return ['node_modules', 'iziToast-master'].includes(entry.name) ? [] : walk(file, exts)
  return exts.some((ext) => file.endsWith(ext)) ? [file] : []
})

let failed = 0
const check = (name, file, run) => {
  try { run() } catch (error) {
    failed++
    const text = String(error?.stderr || error?.message || error).trim().split('\n').slice(0, 6).join('\n    ')
    console.error(`✗ ${name}: ${rel(file)}\n    ${text}`)
  }
}

const scripts = walk(path.join(root, 'src'), ['.js', '.mjs'])
for (const file of scripts) check('script', file, () => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }))

const views = walk(path.join(root, 'src/view'), ['.ejs'])
for (const file of views) check('template', file, () => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }))

const keys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v == 'object' && !Array.isArray(v)) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])
const locales = walk(path.join(root, 'src/locales'), ['.json'])
const english = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/en.json'), 'utf8'))
for (const file of locales) check('language file', file, () => {
  const missing = new Set(keys(english))
  for (const key of keys(JSON.parse(fs.readFileSync(file, 'utf8')))) missing.delete(key)
  if (missing.size) console.warn(`! ${rel(file)}: ${missing.size} text(s) not translated yet, e.g. ${[...missing].slice(0, 3).join(', ')}`)
})

// The site news (src/service/news.js): a feature's news goes live with the feature, so an entry has to be complete
// before it's merged: its texts in all 8 languages, its picture in both sizes, newest entries on top.
const news_file = path.join(root, 'src/service/news.js')
const { NEWS, ACTIONS } = await import(pathToFileURL(news_file))
const { sniff } = await import(pathToFileURL(path.join(root, 'src/service/uploads.js')))
check('news', news_file, () => {
  const dicts = Object.fromEntries(locales.map((file) => [path.basename(file), JSON.parse(fs.readFileSync(file, 'utf8'))]))
  const text_at = (obj, key) => key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj)
  const problems = []
  const seen = new Set()
  let newer = Infinity
  for (const entry of NEWS) {
    const key = entry.key
    if (!/^[a-z0-9_]+$/.test(key || '')) problems.push(`"${key}": a key has only a-z, 0-9 and _`)
    if (seen.has(key)) problems.push(`${key}: in the list twice`)
    seen.add(key)
    const time = /^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') ? Date.parse(`${entry.date}T00:00:00Z`) : NaN
    if (Number.isNaN(time)) { problems.push(`${key}: date "${entry.date}" is not YYYY-MM-DD`) }
    else if (time > newer) { problems.push(`${key}: newer than the entry above it (the newest goes on top)`) }
    else { newer = time }
    if (entry.href && entry.action) problems.push(`${key}: href or action, not both`)
    if (entry.href && !/^\/(?!\/)/.test(entry.href)) problems.push(`${key}: href has to be a site path like /items`)
    if (entry.action && !ACTIONS.includes(entry.action)) problems.push(`${key}: unknown action "${entry.action}" (known: ${ACTIONS.join(', ')})`)
    if (entry.window && !entry.href && !entry.action) problems.push(`${key}: a news window entry needs href or action for its button`)
    if (entry.image) {
      for (const [width, height] of [[1200, 500], [640, 267]]) {
        const file = `src/public/img/news/${entry.image}-${width}.webp`
        if (!fs.existsSync(path.join(root, file))) { problems.push(`${key}: ${file} is missing`); continue }
        const info = sniff(fs.readFileSync(path.join(root, file)))
        if (info?.type != 'image/webp' || info.width != width || info.height != height) problems.push(`${key}: ${file} has to be a ${width} x ${height} WebP`)
      }
    }
    for (const field of entry.window ? ['title', 'text', 'button'] : ['title']) {
      for (const [file, dict] of Object.entries(dicts)) {
        const text = text_at(dict, `news.items.${key}.${field}`)
        if (typeof text != 'string' || !text.trim()) problems.push(`${key}: news.items.${key}.${field} is missing in ${file}`)
      }
    }
  }
  if (problems.length) {
    for (const problem of problems) console.error(`    ${problem}`)
    throw new Error(`${problems.length} thing(s) to fix in the news, listed above`)
  }
})

const style = path.join(root, 'src/public/scss/style.scss')
check('stylesheet', style, () => {
  // the site serves the committed style.css, so it has to be exactly what the SCSS compiles to (a merge can leave it stale or doubled)
  const css = sass.compile(style, { style: 'compressed', logger: sass.Logger.silent }).css
  const built = fs.readFileSync(path.join(root, 'src/public/css/style.css'), 'utf8')
  const plain = (text) => text.replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, '').trim() // `npm run dev` adds a source map line
  if (plain(built) != plain(css)) throw new Error('src/public/css/style.css is out of date, rebuild it with: npx sass --style=compressed --no-source-map src/public/scss/style.scss src/public/css/style.css')
})

console.log(`${scripts.length} scripts, ${views.length} templates, ${locales.length} language files, ${NEWS.length} news entries, 1 stylesheet checked`)
if (failed) {
  console.error(`${failed} problem(s) found`)
  process.exit(1)
}
console.log('All good')
