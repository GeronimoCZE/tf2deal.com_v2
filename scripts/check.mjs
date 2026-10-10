// `npm test`: a quick check that the site still builds, run by the "Node.js CI" GitHub workflow.
//   - every server and page script parses
//   - every page template compiles
//   - every language file is valid JSON (texts missing next to English are listed, they fall back to English)
//   - the stylesheet compiles
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
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

const style = path.join(root, 'src/public/scss/style.scss')
check('stylesheet', style, () => sass.compile(style, { style: 'compressed', logger: sass.Logger.silent }))

console.log(`${scripts.length} scripts, ${views.length} templates, ${locales.length} language files, 1 stylesheet checked`)
if (failed) {
  console.error(`${failed} problem(s) found`)
  process.exit(1)
}
console.log('All good')
