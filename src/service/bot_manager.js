// Admin panel → bot_manager (js/admin_bot_manager.js -> #bots, route: api/routes/admin.js -> POST /bot_manager).
//
// bot_manager answers `admin:*` events on the socket the site already keeps open to it (socket.js, BOTS_ENDPOINT):
//   socket.emit('admin:<scope>:<action>', { admin, ...payload }, (res) => ...)   res = { success: 1, data } | { success: 0, error }
// Its full list is in bot_manager's ADMIN_SOCKET_API.md (or `admin:handlers`). bot_manager trusts whatever arrives on
// that socket, so only the admin API (admin session, see mw.js) calls this.
//
// bot_manager also pushes `admin:changed` (after every change) and `admin:stock_updated` (after a stock recompute);
// socket.js hands them to the admin panel over the /settings socket (settings_socket.js).
import { bot_socket } from './socket.js'

export const EVENT = /^admin:[a-z_]+(:[a-z_]+){0,3}$/

// these can take a while on bot_manager's side (Steam, backpack.tf, a full listing sync)
const SLOW = new Set([
  'admin:key_price:refresh', 'admin:prices:refresh', 'admin:prices:check_db', 'admin:prices:emergency:run',
  'admin:listings:sync', 'admin:listings:verify', 'admin:listings:clear', 'admin:listings:rematch', 'admin:listings:unlisted',
  'admin:stock:recompute', 'admin:stock:sellers', 'admin:holds:backfill', 'admin:buyorders:scan', 'admin:buyorders:keysale',
  'admin:bots:resync_inventory', 'admin:bots:bptf_refresh', 'admin:bots:add', 'admin:bots:enable', 'admin:bots:disable',
  'admin:balance:run', 'admin:balance:move', 'admin:trading:offer:cancel', 'admin:trading:offer:reprocess', 'admin:trading:recent'
])

// bot_manager's error codes in words (ADMIN_SOCKET_API.md → Error codes); anything else is shown as it came
const ERRORS = {
  invalid_steamid: 'That is not a SteamID64 (17 digits).',
  invalid_group_key: 'That is not a stock group key (like 6|cosmetic).',
  invalid_bp_sku: 'Unknown item name.',
  invalid_number: 'That is not a number.',
  invalid_key: 'Missing key.',
  invalid_limit: 'That limit is not allowed.',
  invalid_rules: 'Those rules are not valid.',
  invalid_rule_limit: 'A rule limit must be at least 1.',
  invalid_input: 'Something in the form is not valid.',
  invalid_offerID: 'Missing offer ID.',
  nothing_to_change: 'Nothing to change.',
  bot_not_found: 'That bot is not running.',
  item_not_found: 'Item not found.',
  listing_not_found: 'That listing is gone already.',
  offer_not_found: 'Offer not found.',
  offer_not_active: 'That offer is not open any more.',
  not_an_incoming_offer: 'That is not an incoming offer.',
  not_waiting_for_approval: 'That trade is not waiting for approval any more.',
  steamid_protected: 'That account is one of our bots or a protected admin and cannot be blacklisted.',
  no_bptf_token: 'That bot has no backpack.tf token.',
  not_started: 'That part of bot_manager has not started yet.',
  cancel_failed: 'Steam did not cancel the offer.',
  delete_failed: 'backpack.tf did not remove the listing.',
  missing_bot: 'Pick a bot.',
  invalid_accountName: 'Account name is not valid.',
  invalid_type: 'Type must be trade or warehouse.',
  bot_exists: 'A bot with that account name exists already.',
  nothing_to_update: 'Nothing to update.',
  disable_first: 'Disable the bot first.',
  still_running: 'The bot is still running.',
  still_stopping: 'The bot is still logging off.',
  confirm_with_accountName: 'Type the account name to confirm.',
  invalid_max: 'Max bots must be 1 to 12, or empty for the .env value.',
  invalid_bots: 'Pick two different bots.',
  invalid_cost: 'That is not a price.',
  no_items: 'Enter the asset IDs to move.',
  items_not_movable: 'None of those items can be moved (not on that bot, in a trade, or pure).',
  balance_running: 'A balance run is going on already. Try again in a minute.',
  no_record: 'There is no paid price saved for that copy.',
  key_price_unknown: 'bot_manager has no key price yet.',
  item_in_trade: 'That item is in a trade right now.',
  move_bot_unavailable: 'One of the bots can\'t trade right now.',
  move_send_failed: 'Steam did not take the offer between the bots.',
  move_confirmation_failed: 'The offer between the bots could not be confirmed.',
  move_failed: 'Moving the items failed.',
  listing_takedown_failed: 'backpack.tf did not take the listings down first, so nothing was moved.'
}

const readable = (code) => {
  const text = String(code || 'error')
  if(ERRORS[text]){ return ERRORS[text] }
  if(/^max_bots_running/.test(text)){ return `As many bots as allowed are running already (${text.replace(/\D+/g, '') || 'max'}). Raise Max bots or disable one first.` }
  if(/^max_bots_enabled/.test(text)){ return 'All 12 bot slots are enabled already.' }
  if(/^cannot_decrypt_/.test(text)){ return `bot_manager can't decrypt the saved ${text.slice(16)}: PASSWORD in its .env changed since the bot was saved. Enter it again.` }
  if(/^(missing|invalid)_/.test(text)){ return `${text.startsWith('missing') ? 'Missing' : 'Not valid'}: ${text.replace(/^(missing|invalid)_/, '')}.` }
  return text
}

export const online = () => Boolean(bot_socket.socket?.connected)

// one admin event; `admin` (who did it) goes into bot_manager's audit log
export const ask = (event, payload, admin) => new Promise((resolve) => {
  if(!EVENT.test(String(event || ''))){ return resolve({ status: 'error', message: 'Unknown bot_manager event.' }) }
  const socket = bot_socket.socket
  if(!socket?.connected){ return resolve({ status: 'error', offline: true, message: 'bot_manager is not connected to the site.' }) }
  const body = { ...((payload && typeof payload == 'object' && !Array.isArray(payload)) ? payload : {}), admin: String(admin || 'admin panel') }
  socket.timeout(SLOW.has(event) ? 120000 : 20000).emit(event, body, (err, res) => {
    if(err){ return resolve({ status: 'error', message: 'bot_manager did not answer in time.' }) }
    if(res?.success){ return resolve({ status: 'ok', data: res.data ?? null }) }
    resolve({ status: 'error', code: res?.error || null, message: readable(res?.error) })
  })
})
