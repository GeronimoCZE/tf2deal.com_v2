// The version of what a visitor's open page is made of: a short hash of the page templates, our scripts and styles
// and the texts. It is read once at start, so it changes when an update is pulled and the site restarted.
//
// head.ejs writes it into each page (window.TD_VERSION) and the site socket sends it again on every connection
// (service/socket.js). A tab that was opened before the update gets a different value back and offers a reload
// (js/connection.js). An update that only touches the server side keeps the value, so it asks nobody to reload.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const FOLDERS = ['view', 'locales', 'public/js', 'public/css']

const files = (dir) => {
  let list = []
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return list }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { list = list.concat(files(full)) }
    else if (entry.isFile()) { list.push(full) }
  }
  return list
}

const compute = () => {
  const hash = crypto.createHash('sha1')
  const all = FOLDERS.flatMap((folder) => files(path.join(src, folder))).sort()
  for (const file of all) {
    hash.update(path.relative(src, file).split(path.sep).join('/'))
    hash.update('\0')
    try { hash.update(fs.readFileSync(file)) } catch (e) {}
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 12)
}

export const site_version = compute()
