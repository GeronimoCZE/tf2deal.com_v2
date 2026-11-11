import * as app from '../app.js'
import { bot_account_model } from '../model/SteamBot.js'

// The Steam name of one of our bots, for finished trades ("Latest trades" on the home page, Profile -> Trades), which
// show it linked to the bot's Steam profile. Bots are public (/api/bots lists them), so their Steam ID and name are
// fine to show. Names come from the bot server (fp_data.bots, live while it is connected), else from the bot accounts
// (steam_bots profileName, read at most every READ_EVERY). Never the account's sign-in name.

const READ_EVERY = 10 * 60 * 1000
const STEAMID = /^7656\d{13}$/

const saved = { names: new Map(), read_at: 0, reading: false }

const read_accounts = async () => {
    if (saved.reading || Date.now() - saved.read_at < READ_EVERY || process.db_status?.connected !== true) { return }
    saved.reading = true
    try {
        const docs = await bot_account_model.find({ accountSteamid: { $gt: '' } }, { _id: 0, accountSteamid: 1, profileName: 1 }).lean().maxTimeMS(10 * 1000)
        saved.names = new Map(docs.filter((d) => d.profileName).map((d) => [String(d.accountSteamid), String(d.profileName)]))
        saved.read_at = Date.now()
    } catch (e) {
        saved.read_at = Date.now() // asked again after READ_EVERY
    } finally {
        saved.reading = false
    }
}

// { steamid, name } of the bot a trade record names ('' name when none is known), or null when it isn't a Steam ID
const public_bot = (bot) => {
    const steamid = String(bot ?? '').trim()
    if (!STEAMID.test(steamid)) { return null }
    read_accounts() // in the background: this answer uses what is read already
    const live = (Array.isArray(app.fp_data?.bots) ? app.fp_data.bots : []).find((b) => String(b?.steamid) == steamid)
    const name = String(live?.personaname || live?.name || saved.names.get(steamid) || '').trim().slice(0, 64)
    return { steamid, name }
}

export { public_bot, read_accounts }
