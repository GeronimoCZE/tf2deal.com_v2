/* Admin panel → Bot manager (#bots/<tab>): bot_manager's own settings and state (bots, trading, stock limits,
   listings, prices, buy orders, balance, blacklist).
   Every call goes through POST /api/admin/bot_manager (service/bot_manager.js), which hands it to bot_manager as an
   `admin:*` socket event (bot_manager's ADMIN_SOCKET_API.md). bot_manager's pushes (admin:changed after every
   change, admin:stock_updated after a stock recompute) come over the /settings socket (admin.js), so the open tab
   reloads when something changes, also when another admin changed it. */
(() => {
    const kit = window.admin_kit
    const sections = window.admin_sections
    if(!kit || !sections){ return }
    const { esc, when, ago, num, uptime, toast, head, stat, pill, on_live, QUALITY_NAMES } = kit

    const bm = (event, payload) => kit.api('/api/admin/bot_manager', { event, payload })
    const loading = '<div class="admin-loading"><span class="admin-spinner"></span> Loading…</div>'

    /* ========================= SHARED ========================= */

    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
    const pct = (x) => (x == null || Number.isNaN(Number(x))) ? '–' : `${Math.round(Number(x) * 100)} %`
    const keys = (n) => n == null ? '–' : `${num(r2(n))} keys`
    const ref = (n) => n == null ? '–' : `${num(r2(n))} ref`
    const later = (ms) => {
        if(!ms){ return '–' }
        const s = Math.round((ms - Date.now()) / 1000)
        if(s <= 30){ return 'now' }
        if(s < 3600){ return `in ${Math.round(s / 60)} min` }
        if(s < 86400){ return `in ${Math.round(s / 3600)} h` }
        return when(ms)
    }
    // "5 min ago" in a big number tile: the unit small, like the other tiles
    const ago_stat = (ms) => { const text = ago(ms), m = text.match(/^(\d+) (.+)$/); return m ? `${m[1]}<small> ${m[2]}</small>` : `<small>${text}</small>` }
    const profile = (steamid, name) => steamid
        ? `<a href="https://steamcommunity.com/profiles/${esc(steamid)}" target="_blank" rel="noopener nofollow">${esc(name || steamid)}</a>` : '–'

    // bot_manager's reason codes in words; anything else is shown with spaces
    const REASONS = {
        no_price: 'no price', unpriced_paint: 'paint has no price', unpriced_spells: 'spells have no price', unpriced_killstreak: 'killstreak has no price',
        unpriced_festivized: 'festivized has no price', deactivated: 'item turned off', blocked: 'never list', excluded: 'excluded by regex', paused: 'paused',
        bot_offline_or_in_trade: 'bot offline or item in a trade', currency_weapon: 'craft weapon (currency)', no_key_rate: 'no key price', too_cheap: 'too cheap',
        no_slot: 'no free listing slot', create_failed: 'backpack.tf refused it', waiting: 'waiting', waiting_for_backpack_tf: 'waiting for backpack.tf',
        variant_listed: 'another copy is listed', not_in_stock: 'not in stock', not_planned_yet: 'not looked at yet', no_pure: 'not enough pure', budget: 'over the budget',
        group_limit: 'group is full', max_new_per_sync: 'new listings per sync used up', too_big: 'too expensive', buy_pace: 'buying slowed down',
        no_db_item: 'no such item in the database', quality_mismatch: 'quality not in the database', not_active: 'item not active', no_sell_price: 'no sell price',
        priced_now: 'has a price now', sku_limit: 'item limit reached', group_value: 'group value cap reached', group_full: 'group full, selling down',
        group_blocked: 'group blocked', group_min_pure: 'needs more pure first', buying_paused: 'buying paused', pure_reserve: 'would go under the pure reserve',
        stock_limit: 'stock limit', restricted_paint: 'buy order wants other paint', restricted_spells: 'buy order wants other spells', restricted_parts: 'buy order wants other parts',
        restricted_festivized: 'buy order wants festivized or not', restricted_sheen: 'buy order wants another sheen', restricted_text: 'buy order text restricts it',
        other_killstreak: 'other killstreak', other_quality: 'other quality', other_effect: 'other effect', other_series: 'other series', no_trade_link: 'no trade link',
        already_offered: 'offered already', buyer_cooldown: 'buyer on cooldown', offer_open: 'an offer is open', banned: 'buyer banned', blacklisted: 'buyer blacklisted',
        no_copy: 'no copy at their price', limit: 'offer limit reached', metal_ok: 'enough metal', no_spare_keys: 'no spare keys', daily_limit: 'daily limit reached',
        no_buyer: 'no buyer', no_buy_orders: 'no buy orders', no_bot: 'no bot', rate_limited: 'backpack.tf rate limit', no_key_price: 'no key price', no_token: 'no backpack.tf token',
        sent: 'sent', failed: 'failed', off: 'off', error: 'error', buying_more: 'buying more than we sell', selling_more: 'selling more than we buy', balanced: 'balanced',
        hold: 'held at what we paid', break_even: 'at what we paid', min_loss: 'small loss allowed', released: 'market price', none: 'no record',
        trade: 'trade', trade_no_receipt: 'trade (no receipt)', trade_history: 'estimated', admin: 'set by hand'
    }
    const words = (code) => esc(REASONS[code] || String(code ?? '').replace(/_/g, ' '))

    // "6|cosmetic" → Unique cosmetic, "5|cosmetic|13" → Unusual cosmetic, effect 13
    const group_name = (key) => {
        const [quality, type, effect] = String(key || '').split('|')
        return `${esc(QUALITY_NAMES[quality] || `Quality ${quality}`)} ${esc(type || '')}${effect ? `<span class="muted">, effect ${esc(effect)}</span>` : ''}`
    }

    const failed = (box, res) => {
        box.innerHTML = `<div class="admin-card admin-bm-offline">
            <p class="admin-error">${esc(res.message || 'bot_manager did not answer.')}</p>
            ${res.offline ? '<p class="muted">The site reaches bot_manager over <code>BOTS_ENDPOINT</code> in <code>.env</code>. Once bot_manager is running and connected, this page works.</p>' : ''}
            <button type="button" data-bm-retry>Try again</button>
        </div>`
        box.querySelector('[data-bm-retry]').addEventListener('click', () => window.dispatchEvent(new HashChangeEvent('hashchange')))
    }
    const error_line = (res) => `<p class="admin-error">${esc(res.message || 'bot_manager did not answer.')}</p>`

    const table = (cols, rows, empty = 'Nothing here.') => rows.length
        ? `<div class="admin-table-wrap"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : `<p class="admin-empty">${empty}</p>`

    // { reason: count } as tags, biggest first
    const counts = (obj, empty = 'Nothing.') => {
        const list = Object.entries(obj || {}).filter(([, n]) => Number(n) > 0).sort((a, b) => b[1] - a[1])
        return list.length ? `<div class="admin-bm-counts">${list.map(([k, n]) => `<span class="admin-tag">${words(k)} <b>${num(n)}</b></span>`).join('')}</div>` : `<p class="admin-empty">${empty}</p>`
    }

    // label: value rows (small facts in a card)
    const facts = (rows) => `<dl class="admin-bm-facts">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`

    // one button = one bot_manager call: <button data-do="admin:…" data-args='{…}'>, wired by actions() below
    const act = (event, args, label, o = {}) => `<button type="button"${o.cls ? ` class="${o.cls}"` : ''} data-do="${esc(event)}" data-args="${esc(JSON.stringify(args || {}))}"${o.confirm ? ` data-confirm="${esc(o.confirm)}"` : ''}${o.ok ? ` data-ok="${esc(o.ok)}"` : ''}>${label}</button>`
    const actions = (el, after) => el.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-do]')
        if(!btn || !el.contains(btn) || btn.disabled){ return }
        if(btn.dataset.confirm && !confirm(btn.dataset.confirm)){ return }
        let args = {}
        try { args = JSON.parse(btn.dataset.args || '{}') } catch (err) { args = {} }
        const label = btn.innerHTML
        btn.disabled = true
        btn.textContent = 'Working…'
        const res = await bm(btn.dataset.do, args)
        btn.disabled = false
        btn.innerHTML = label
        if(toast(res, esc(btn.dataset.ok || 'Done.'))){ after?.(res, btn) }
    })

    const busy = async (btn, work) => {
        const label = btn.innerHTML
        btn.disabled = true
        btn.textContent = 'Working…'
        try { return await work() } finally { btn.disabled = false; btn.innerHTML = label }
    }

    /* ========================= SETTINGS CARD ========================= */

    // bot_manager's settings come as { config, defaults }. The card shows a field per value (switch, number, text, list,
    // "name = number" lines for the maps), grouped by their first key, with the default under each; Save sends only
    // what changed (bot_manager merges a partial config), Reset asks bot_manager for its defaults.
    const HELP = {
        stock: {
            enabled: 'Off: only the per-item stock.limit stored in the DB is used (old behaviour).',
            recomputeMin: 'Full recompute every N minutes (+ after admin changes).',
            historyDays: 'Trade history window.',
            halfLifeDays: 'A sale 7 days ago counts half as much as one today.',
            writeSkuLimits: 'Write per-item limits to item_instances.stock.limit (site + listings read it).',
            'pure.targetRatio': 'Aim: pure = 30 % of our total value (pure + items).',
            'pure.exponent': 'How hard pressure reacts to being off target.',
            'pure.minPressure': 'Limits never shrink below 25 % of their healthy size.',
            'pure.maxPressure': '...and never grow above 150 %.',
            'pure.smoothing': 'Weight of the new value when pressure rises (lower = steadier).',
            'pure.dropSmoothing': 'Weight when pressure falls (react faster when pure runs low).',
            'pure.minPureKeys': 'Below this much pure, pressure is forced to minPressure.',
            'pure.reserveKeys': 'Never accept a trade that pays out pure below this (0 = off).',
            'group.unusualByEffect': 'Unusual groups are split by effect.',
            'group.pureLimitedQualities': 'Groups of these qualities are measured against pure, not total value (unusual-quality groups without an effect, i.e. unusualifiers, aren\'t).',
            'group.pureLimitedMinPriceKeys': '...and so is any group whose average item costs this much.',
            'group.effectMinPureKeys': 'Unusuals with an effect are not bought until pure reaches this (0 = off).',
            'group.minShare': 'Value share of TOTAL value a slow group may hold.',
            'group.maxShare': '...a fast group.',
            'group.pureMinShare': 'Value share of PURE a slow pure-limited group may hold.',
            'group.pureMaxShare': '...a fast one.',
            'group.exploreShare': 'An empty group may still buy 1 item costing up to 8 % of pure.',
            'group.velocityRefPerDay': 'Items sold per day that count as "fast" (score ≈ 0.63).',
            'group.boughtWeight': 'Buying counts a bit as activity too.',
            'group.sellThroughPad': '(sold + pad) / (bought + pad).',
            'group.minSellThrough': 'Groups we buy but don\'t sell lose up to 70 % of their score.',
            'group.marketRefBuyorders': 'Median backpack.tf buy orders that count as "popular".',
            'group.marketTrust': 'How much the market signal counts before we have own trades.',
            'group.confidenceTrades': 'Own trades needed for ~50 % trust in own history.',
            'group.coverDays': 'With enough history: hold at most ~14 days of sales.',
            'group.coverFromSalesOnly': '...counting sales only (false = buys count 30 % too, old behaviour).',
            'group.minHistoryDaysForCover': '...and our history must go back this many days.',
            'group.longSalesDays': 'Sales from item trade_history over this many days also count.',
            'group.pureCapMinShare': 'Any group holds items worth at most 4 % of pure when slow...',
            'group.pureCapMaxShare': '...25 % when fast (pure-limited groups use pureMin/MaxShare).',
            'group.resumeAt': 'A full group is held until its stock sells down to 50 % of the limit (and 50 % of its value cap); 1 = buy again after every sale.',
            'group.coldMaxLimit': 'Without enough history: limit ≤ coldMaxLimit × score (min 1).',
            'group.maxGrowthPerRun': 'Limits grow max +25 % (min +1) per recompute, shrink at once.',
            'sku.maxLimit': 'The cheapest, most liquid items.',
            'sku.singleQualities': 'Unusual + collector\'s: 1 per item.',
            'sku.singleExceptRegex': '...except these (regex on type or name).',
            'sku.priceRefKeys': 'Price where the price factor is 0.5.',
            'sku.priceExponent': 'How steeply the limit falls with price (1 = steep, 0.5 = gentle).',
            'sku.demandRef': 'Buy orders for a full demand factor.',
            'sku.volumeRef': 'Sell orders for a full volume factor.',
            'sku.ownRefPerWeek': 'Our own sales per week for a full factor.',
            'sku.halveOnLowSellThrough': 'Bought ≥ 3, sold < 30 % of that → limit halved.',
            'sku.syncListable': 'Unusual / collector\'s: bptf_data.listable follows limit > 0 (like the old thresholds).',
            'listings.perGroupFactor': 'Buy listings per group ≤ group headroom × factor (min 1).',
            flow: 'Buy / sell balance (saved trades of the last `days`): buying more than we sell slows buying down.',
            'flow.enabled': 'Off: the balance is only reported, nothing is adjusted.',
            'flow.days': 'Window for the balance.',
            'flow.halfLifeDays': 'A trade 3 days ago counts half as much as one today.',
            'flow.minTrades': 'Fewer item trades in the window → pace 1 (not enough to judge).',
            'flow.minValueKeys': '...or less item value moved (bought + sold) than this.',
            'flow.tolerance': 'Buying up to 1.25x the value we sell is fine (bought items count at buy price, sold ones at sell price, so this is forgiving already).',
            'flow.exponent': 'Above the tolerance: pace = (tolerance / ratio) ^ exponent.',
            'flow.minPace': 'Buying never slows below 35 %.',
            'flow.boostBelow': 'Selling clearly more than we buy (ratio < 0.7) → buy a bit more...',
            'flow.maxPace': '...up to 120 %.',
            'flow.smoothing': 'Weight of the new value when the pace rises (lower = steadier).',
            'flow.dropSmoothing': '...when it falls.',
            'flow.sellerShield': 'Groups / items that sell well are spared up to 60 % of the slowdown.',
            'flow.focus': 'Buy listing rank uses sales factor ^ (1 + focus × slowdown).',
            'flow.salesRefPerWeek': 'Own sales per week that count as "sells well".',
            'flow.confidenceTrades': 'Own trades of an item for ~50 % trust in its own numbers.'
        },
        listings: {
            syncIntervalMin: 'Full sync every N minutes (plus quick syncs after trades / price updates).',
            priceWatchSec: 'Check the DB for changed prices of our items / buy listings every N seconds.',
            priceFullCheckMin: '... and compare every one of them every N minutes (0 = off).',
            priceWatchOfflineSec: 'DB check interval while item_manager\'s socket is disconnected.',
            verifyMin: 'Compare our listings\' prices with what backpack.tf shows every N minutes (0 = off).',
            relistAfterPatchFails: 'A price update (PATCH) failing this often in a row: delete + create the listing instead.',
            emergency: 'item_manager down (socket lost or no new prices in the DB) and our items\' DB prices old: bot_manager prices the listed items from backpack.tf listings itself.',
            'emergency.socketDownMin': 'Item_manager counts as down when its socket is gone this long...',
            'emergency.dbIdleMin': '...or it wrote no new price to the DB for this long.',
            'emergency.staleMin': 'An item\'s DB price older than this is repriced.',
            'emergency.everyMin': 'The same item at most this often.',
            'emergency.maxPerRun': 'Backpack.tf snapshot calls per run (one call every 2 s).',
            'emergency.maxDrop': 'An emergency sell price moves at most 20 % below the last item_manager price...',
            'emergency.maxRise': '...and 50 % above it; buy prices only go down.',
            'emergency.minProfit': 'Sell stays at least this much (ref) above buy.',
            'emergency.minBuyListings': 'Buy price = mean of the top 3 buy orders (fewer: the highest one).',
            quickSyncDelaySec: 'Debounce for event-triggered syncs.',
            slotLimit: 'Listing slots per bot; 0 = BPTF_LISTING_LIMIT env / bot setting / 100.',
            botSlotLimits: 'Slots of single bots (account name, persona name or steamid → slots); wins over everything above.',
            offlineGraceMin: 'A bot offline this long gets its listings removed.',
            text: 'Listing texts, at most 200 characters. {command} = the chat command with the item name for an automatic trade offer ("!buy Team Captain"), {name}, {url} = the item\'s trade page (sell) or the site (buy), {site}. Empty = the default text. Too long for a long item name: the short one is used.',
            'text.refreshPerSync': 'Listings with an old text recreated per sync (0 = all at once).',
            'sell.repriceToMin': 'A copy priced under minPrice is listed at minPrice instead of not at all.',
            'sell.excludeRegex': 'Items whose name or type matches this regex are never listed for sale ($^ = none).',
            'buy.minBuyorders': '"popular": at least this many buy orders on backpack.tf.',
            'buy.topMinBuyorders': '...for topRegex items (unusualifiers: each one is niche, most have few).',
            'buy.demandRegex': 'War paints and skins (this regex) are only bought when they are in high demand:',
            'buy.demandMinBuyorders': '...at least this many buy orders (Decorated Weapon quality 15 counts as skin).',
            'buy.minMargin': 'Margin a buy listing must leave: (sell - buy) / buy.',
            'buy.minProfit': 'Profit per item (ref) a buy listing must leave.',
            'buy.maxPriceKeys': 'Buy orders get bigger as pure grows, but one buy order never costs more than this.',
            'buy.maxOrderShare': '...nor more than 25 % of all bots\' pure together (bots lend each other pure).',
            'buy.orderSpread': '...nor more than 6x the average order (pure budget ÷ buy slots we can fill).',
            'buy.maxBotPureShare': 'The bot listing it uses at most half its own pure on one order (backpack.tf sellers take the pure from that bot\'s inventory).',
            'buy.maxPriceAgeHours': 'Only items priced recently by item_manager.',
            'buy.budgetMultiplier': 'A bot may advertise buy listings worth up to 1.5x its free pure.',
            'buy.minAgeHours': 'Never rotate a buy listing younger than this.',
            'buy.idleHours': 'No trade / offer for this long → may be replaced by a better item.',
            'buy.lostInterestRatio': 'Buy orders dropped below minBuyorders * ratio → may be replaced.',
            'buy.idlePenalty': 'Score multiplier for replaceable listings when competing with new ones.',
            'buy.reservedSlotShare': 'Up to this share of each bot\'s slots is kept for buy listings when there are good buy candidates (sell listings get the rest); 0 = sells may take every slot.',
            'buy.topRegex': 'Buy priorities (score multipliers, matched on name and type, first match wins): unusualifiers first...',
            'buy.preferRegex': '...then popular site-traffic items: tools, action items, cases / crates, war paints, skins, parts, kits.',
            'buy.baseRegex': '...then cosmetics and weapons.',
            'buy.nichePenalty': 'Score multiplier for unusuals with a specific effect.',
            'buy.priorityPriceMin': 'Ask item_manager to reprice topRegex items at least this often (\'pricePriority\').',
            'buy.excludeRegex': 'Items whose name or type matches this regex are never bought.',
            'buy.topBoost': 'Score multiplier for topRegex items.',
            'buy.preferBoost': 'Score multiplier for preferRegex items.',
            'buy.baseBoost': 'Score multiplier for baseRegex items.',
            'buy.maxNewPerSync': 'New buy listings per sync at most.',
            'sell.minPrice': 'Cheapest sell listing (ref).',
            'buy.minPrice': 'Cheapest buy listing (ref).'
        },
        holds: {
            holdDays: 'After the price drops: ask at least what we paid + holdMargin this long.',
            breakEvenDays: 'Then at least what we paid this long.',
            maxLoss: 'Then at least what we paid - 5 % (0 = never under what we paid).',
            releaseDays: '> 0: after this many days the copy sells at the market price; 0 = never.',
            backfillDays: 'First start: copies without a record get the buy price of saved trades this recent.',
            enabled: 'Off: copies are always listed at the market price, whatever we paid.',
            holdMargin: 'Share above what we paid while the copy is held.'
        },
        buyorders: {
            websocket: 'Listen to backpack.tf\'s live listing feed (trade links, new buy orders right away).',
            scanMin: 'Check the buy orders of the items we sell this often.',
            scanPerRun: 'Items per check (one backpack.tf call each).',
            offerMinutes: 'An unanswered offer is cancelled after this.',
            maxOpenOffers: 'Offers to buy orders waiting for an answer at once.',
            minProfit: 'Ref a buy order must pay above what we ask (0 = our price or more).',
            repeatDays: 'The same buyer isn\'t offered the same item again for this long.',
            buyerCooldownHours: 'A buyer who couldn\'t get an offer is skipped this long.',
            checkEscrow: 'No offers to buyers with a trade hold.',
            maxLinks: 'Trade links remembered from the live feed.',
            skipText: 'Listing text that marks a restricted buy order (cosmetics / weapons).',
            keySale: 'Short of metal: sell spare keys to backpack.tf key buy orders for the metal we lack most.',
            keySaleEveryMin: 'How often we look for a key buyer while short of metal.',
            keySaleMaxPerDay: 'Key sale offers per day (one waiting at a time).',
            keySaleUnderKeyPrice: 'A key buy order may pay this much (ref) under our key price.',
            keySaleMaxItems: 'Metal items one key sale may bring in.',
            keepKeys: 'Never sell keys below this many (0 = bot balance minimum × bots).',
            metalTargetRef: 'Enough metal (0 = bot balance minimum × bots).',
            enabled: 'Send one-time offers to other traders\' backpack.tf buy orders that pay our price or more.',
            maxOffersPerHour: 'Offers to buy orders per hour at most.',
            keysPerSale: 'Keys sold in one key sale.',
            metalTargetRec: 'Enough reclaimed (0 = bot balance minimum × bots).',
            metalTargetScrap: 'Enough scrap (0 = bot balance minimum × bots).'
        },
        balance: {
            enabled: 'Off: nothing moves by itself (Balance now on the Balance tab still works).',
            intervalMin: 'How often pure and slots are checked.',
            'pure.minKeep': 'A bot never gives pure below this.',
            'pure.lendKeepsMin': '...also not when another bot borrows its pure for a site trade.',
            'pure.minMove': 'Smaller top-ups aren\'t worth a trade.',
            'pure.tolerance': 'A bot within 15 % of the average isn\'t topped up.',
            'slots.capacity': 'Backpack slots of a bot (TF2 maximum).',
            'slots.capacityByBot': 'Account name / steamid -> slots, when a bot has fewer.',
            'slots.dumpBelowFree': 'Fewer free slots: items go to other bots right away.',
            'slots.balanceBelowFree': 'Bots with fewer free slots are evened out with the others.',
            'slots.tolerance': '...when they\'re this many free slots below the average.',
            'slots.keepFree': 'A receiving bot keeps at least this many free slots.',
            'listings.minRoom': 'A receiving bot needs this many free sell listing slots.',
            'pure.enabled': 'Even out pure between the trade bots.',
            'pure.maxOffersPerRun': 'Offers between bots per check at most.',
            'slots.enabled': 'Even out backpack slots between the trade bots.',
            'slots.maxItemsPerOffer': 'Items in one offer between bots.',
            'slots.maxItemsPerRun': 'Items moved per check at most.',
            'listings.enabled': 'Move items that wait for a listing slot to a bot with free slots.',
            'listings.maxItemsPerRun': 'Items moved per check at most.'
        },
        offers: {
            maxItemsPerSide: 'Incoming offers with more non-pure items on one side are ignored.',
            maxUnpricedUserItems: 'Unknown items the user may add (gifts / junk) before we ignore the offer.',
            overpayMinRef: 'Accept a user overpay up to max(this, overpayPct × value).',
            nearMissPct: 'Offers this close to the right value aren\'t counted as junk.',
            counterOffers: 'User a little short (within nearMissPct): send the same trade back at the right price.',
            counterCooldownHours: 'At most one counter offer per user in this window (unless they accepted it).',
            counterOfferMinutes: 'A counter offer left open this long is canceled.',
            scrapWeapons: 'One craftable Unique 0.05 / 0.055 ref weapon pays a half-scrap remainder (max one per trade).',
            retryAttempts: 'Offers we couldn\'t evaluate (reserved items, missing key price, errors) are retried.',
            overpayPct: 'Share of the trade value a user may overpay (see overpayMinRef).',
            retryDelaySec: 'Wait between those retries.'
        }
    }
    const MAPS = new Set(['botSlotLimits', 'slots.capacityByBot']) // name → number, a key goes away on null
    const UNITS = [[/Min$/, 'min'], [/Sec$/, 's'], [/Hours$/, 'h'], [/Days$/, 'days'], [/Keys$/, 'keys'], [/Ref$/, 'ref'], [/Pct$/, 'share']]
    const REF_FIELDS = /(^|\.)(minPrice|minProfit)$/ // in ref, but the name doesn't say so
    const GROUP_NAMES = {
        '': 'General', pure: 'Pure', group: 'Groups', sku: 'Single items', listings: 'Buy listings per group', flow: 'Buy / sell balance',
        emergency: 'Emergency pricing', text: 'Listing texts', sell: 'Sell listings', buy: 'Buy listings', slots: 'Backpack slots', offers: 'Offer rules'
    }

    const humanize = (path) => {
        let key = path.split('.').pop()
        let unit = REF_FIELDS.test(path) ? 'ref' : ''
        for (const [re, u] of UNITS) {
            if(re.test(key) && key.replace(re, '')){ unit = u; key = key.replace(re, ''); break }
        }
        const text = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase()
        const prefix = path.split('.').slice(1, -1).map((k) => `${k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()}: `).join('')
        const label = prefix + text
        return { label: label[0].toUpperCase() + label.slice(1), unit }
    }
    const get_path = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    const set_path = (obj, path, value) => {
        const parts = path.split('.')
        const last = parts.pop()
        let o = obj
        for (const k of parts) { o = (o[k] = (o[k] && typeof o[k] == 'object') ? o[k] : {}) }
        o[last] = value
        return obj
    }
    const leaves = (obj, prefix = '', out = []) => {
        for (const [k, v] of Object.entries(obj || {})) {
            const path = prefix ? `${prefix}.${k}` : k
            if(MAPS.has(path) || v === null || typeof v != 'object' || Array.isArray(v)){ out.push(path) } else { leaves(v, path, out) }
        }
        return out
    }
    const kind_of = (path, sample) => MAPS.has(path) ? 'map' : typeof sample == 'boolean' ? 'bool' : typeof sample == 'number' ? 'number' : Array.isArray(sample) ? 'list' : 'text'
    const map_text = (map) => Object.entries(map || {}).map(([k, n]) => `${k} = ${n}`).join('\n')
    const shown = (value, kind) => kind == 'bool' ? (value ? 'on' : 'off') : kind == 'list' ? ((value || []).join(', ') || 'empty')
        : kind == 'map' ? (Object.keys(value || {}).length ? Object.entries(value).map(([k, n]) => `${k} = ${n}`).join(', ') : 'none')
        : (value === '' || value == null) ? 'empty' : String(value)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

    // a field's value as typed, or { error }
    const read_field = (f) => {
        const input = f.input
        if(f.kind == 'bool'){ return { value: input.checked } }
        const raw = input.value
        if(f.kind == 'number'){
            if(raw.trim() === '' || Number.isNaN(Number(raw))){ return { error: 'Enter a number.' } }
            return { value: Number(raw) }
        }
        if(f.kind == 'list'){
            const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
            const numbers = typeof (f.def || [])[0] == 'number'
            if(numbers && parts.some((p) => Number.isNaN(Number(p)))){ return { error: 'Only numbers, separated by commas.' } }
            return { value: numbers ? parts.map(Number) : parts }
        }
        if(f.kind == 'map'){
            const map = {}
            for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
                const m = line.match(/^(.+?)\s*[=:]\s*(\d+)$/)
                if(!m){ return { error: `"${line}" is not "name = number".` } }
                map[m[1].trim()] = Number(m[2])
            }
            return { value: map }
        }
        if(/Regex$/.test(f.path)){
            try { new RegExp(raw, 'i') } catch (err) { return { error: 'That is not a valid regular expression.' } }
        }
        return { value: raw }
    }

    const field_html = (f, id) => {
        const { label, unit } = humanize(f.path)
        const custom = f.def !== undefined && !same(f.value, f.def)
        const help = `<span class="admin-help">${f.help ? `${esc(f.help)} ` : ''}<span class="admin-bm-default">Default ${esc(shown(f.def, f.kind))}.</span></span>`
        const title = `<span class="admin-bm-name" title="${esc(f.path)}">${esc(label)}${custom ? '<i class="admin-bm-custom" title="Not the default"></i>' : ''}</span>`
        if(f.kind == 'bool'){
            return `<div class="admin-bm-field kind-bool" data-path="${esc(f.path)}">
                <div class="admin-bm-label"><label for="${id}">${title}</label><label class="admin-switch"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}><span></span></label></div>
                ${help}</div>`
        }
        let input
        if(f.kind == 'number'){
            input = `<span class="admin-input-unit${unit ? '' : ' no-unit'}"><input type="number" id="${id}" step="any" value="${esc(f.value)}" required>${unit ? `<em>${unit}</em>` : ''}</span>`
        } else if(f.kind == 'map'){
            input = `<textarea id="${id}" rows="3" class="admin-code" placeholder="name = number" spellcheck="false">${esc(map_text(f.value))}</textarea>`
        } else if(f.path.startsWith('text.')){
            input = `<textarea id="${id}" rows="3" maxlength="200" placeholder="${esc(f.placeholder || '')}">${esc(f.value)}</textarea>`
        } else {
            input = `<input type="text" id="${id}" value="${esc(f.kind == 'list' ? (f.value || []).join(', ') : f.value ?? '')}"${/Regex$/.test(f.path) ? ' class="admin-code" spellcheck="false"' : ''}${f.kind == 'list' ? ' placeholder="comma, separated"' : ''}>`
        }
        return `<div class="admin-bm-field kind-${f.kind}${f.path.startsWith('text.') || f.kind == 'map' || /Regex$/.test(f.path) ? ' is-wide' : ''}" data-path="${esc(f.path)}">
            <label class="admin-bm-label" for="${id}">${title}</label>${input}${help}</div>`
    }

    let card_ids = 0
    // o: { title, intro, load() → { status, data: { config, defaults, placeholders? } }, save(patch), reset(), help, only(path), open }
    const settings_card = (host, o) => {
        const cid = `bmc${++card_ids}`
        host.insertAdjacentHTML('beforeend', `<div class="admin-card wide admin-bm-config" data-card="${cid}">
            <div class="admin-card-head"><div><h3>${o.title}</h3>${o.intro ? `<p class="muted">${o.intro}</p>` : ''}</div>
                ${o.reset ? '<button type="button" data-reset>Reset to defaults</button>' : ''}</div>
            <div class="admin-bm-body">${loading}</div>
            <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save disabled>Save</button></div>
        </div>`)
        const card = host.lastElementChild
        const body = card.querySelector('.admin-bm-body')
        const save = card.querySelector('[data-save]')
        let fields = []

        const draw = (data) => {
            const config = data.config || {}, defaults = data.defaults || {}
            const paths = [...new Set([...leaves(defaults), ...leaves(config)])].filter((p) => !o.only || o.only(p))
            fields = paths.map((path) => {
                const value = get_path(config, path) ?? get_path(defaults, path)
                const def = get_path(defaults, path)
                return { path, value, def, kind: kind_of(path, def ?? value), help: o.help?.[path], placeholder: data.placeholders?.[path] }
            })
            const groups = new Map()
            for (const f of fields) {
                const top = f.path.includes('.') ? f.path.split('.')[0] : ''
                if(!groups.has(top)){ groups.set(top, []) }
                groups.get(top).push(f)
            }
            let i = 0
            body.innerHTML = [...groups].map(([top, list]) => {
                const custom = list.filter((f) => f.def !== undefined && !same(f.value, f.def)).length
                const inner = `${top && o.help?.[top] ? `<p class="admin-help admin-bm-group-help">${esc(o.help[top])}</p>` : ''}
                    <div class="admin-bm-fields">${list.map((f) => field_html(f, `${cid}-${i++}`)).join('')}</div>`
                if(groups.size == 1){ return inner }
                return `<details class="admin-bm-group"${!top || o.open?.includes(top) ? ' open' : ''}>
                    <summary><span>${esc(GROUP_NAMES[top] || humanize(top).label)}</span><span class="muted">${list.length} setting${list.length == 1 ? '' : 's'}${custom ? `, ${custom} not default` : ''}</span></summary>
                    ${inner}</details>`
            }).join('') || '<p class="admin-empty">No settings.</p>'
            for (const f of fields) { f.el = body.querySelector(`[data-path="${CSS.escape(f.path)}"]`); f.input = f.el.querySelector('input, textarea') }
            card.classList.remove('is-dirty', 'is-stale')
            save.disabled = true
        }

        const load = async () => {
            const res = await o.load()
            if(!card.isConnected){ return }
            if(res.status != 'ok'){ body.innerHTML = error_line(res); return }
            draw(res.data)
        }

        const check = () => {
            let dirty = false
            for (const f of fields) {
                const r = read_field(f)
                const changed = Boolean(r.error) || !same(r.value, f.value)
                f.el.classList.toggle('is-changed', changed)
                f.input.setCustomValidity('')
                dirty = dirty || changed
            }
            card.classList.toggle('is-dirty', dirty)
            save.disabled = !dirty
        }
        body.addEventListener('input', check)
        body.addEventListener('change', check)

        card.querySelector('[data-discard]').addEventListener('click', load)
        save.addEventListener('click', async () => {
            const patch = {}
            for (const f of fields) {
                const r = read_field(f)
                if(r.error){
                    f.el.closest('details')?.setAttribute('open', '')
                    f.input.setCustomValidity(r.error)
                    f.input.reportValidity()
                    return
                }
                if(same(r.value, f.value)){ continue }
                if(f.kind == 'map'){ // send the whole map, removed names as null so bot_manager drops them
                    const next = { ...r.value }
                    for (const k of Object.keys(f.value || {})) { if(!(k in next)){ next[k] = null } }
                    set_path(patch, f.path, next)
                } else {
                    set_path(patch, f.path, r.value)
                }
            }
            if(!Object.keys(patch).length){ check(); return }
            const res = await busy(save, () => o.save(patch))
            if(toast(res, 'Saved. bot_manager uses it right away.')){ await load() }
        })
        card.querySelector('[data-reset]')?.addEventListener('click', async (e) => {
            if(!confirm(`Put every setting in "${o.title}" back to bot_manager's default?`)){ return }
            const res = await busy(e.currentTarget, () => o.reset())
            if(toast(res, 'Back to the defaults.')){ await load() }
        })

        return {
            load,
            // changed somewhere else: load it, unless the admin is editing (then say so, like Live settings does)
            changed: () => card.classList.contains('is-dirty') ? card.classList.add('is-stale') : load()
        }
    }

    // a bot_manager settings pair: admin:<scope>:settings, admin:<scope>:config:update, admin:<scope>:config:reset
    const scope_settings = (scope, extra = (d) => d) => ({
        load: async () => { const r = await bm(`admin:${scope}:settings`); return r.status == 'ok' ? { status: 'ok', data: extra(r.data) } : r },
        save: (config) => bm(`admin:${scope}:config:update`, { config }),
        reset: () => bm(`admin:${scope}:config:reset`)
    })

    /* ========================= OVERVIEW ========================= */

    const audit = (res) => res.status != 'ok' ? error_line(res)
        : !res.data?.length ? '<p class="admin-empty">No changes since bot_manager started.</p>'
        : `<ul class="admin-activity admin-bm-audit">${res.data.map((a) => `<li>
            <span class="muted">${ago(a.time)}</span>
            <span>${a.admin ? profile(a.admin, /^\d{17}$/.test(a.admin) ? `…${a.admin.slice(-5)}` : a.admin) : 'unknown'}</span>
            <span><code>${esc(String(a.event || '').replace(/^admin:/, ''))}</code>${a.ok ? '' : ` <span class="admin-error">${words(a.error)}</span>`}
                ${a.payload && a.payload != '{}' ? `<span class="admin-help admin-bm-payload">${esc(a.payload)}</span>` : ''}</span>
        </li>`).join('')}</ul>`

    const tab_overview = async (box, ctx) => {
        const draw = async () => {
            const [res, log] = await Promise.all([bm('admin:overview'), bm('admin:audit_log', { limit: 30 })])
            if(!box.isConnected){ return }
            if(res.status != 'ok'){ return failed(box, res) }
            const o = res.data || {}, s = o.stock || {}, l = o.listings || {}, t = o.trading || {}, inv = o.inventory || {}, v = inv.values || {}, sw = t.switches || {}
            box.innerHTML = `<div class="admin-stats">
                    ${stat('Bots online', `${num(o.bots?.online)}<small> of ${num(o.bots?.total)}</small>`, `${num(o.bots?.trade)} trade, ${num(o.bots?.warehouse)} warehouse${o.bots?.paused ? `, ${num(o.bots.paused)} paused` : ''}`, '#bots/bots')}
                    ${stat('Key price', o.keyPrice != null ? `${num(r2(o.keyPrice))}<small> ref</small>` : '–', o.keyUpdated ? `updated ${ago(o.keyUpdated)}` : '')}
                    ${stat('Pure', `${num(inv.pure?.keys)}<small> keys</small>`, `${num(inv.pure?.ref)} ref, ${num(inv.pure?.rec)} rec, ${num(inv.pure?.scrap)} scrap`)}
                    ${stat('Total value', v.totalKeys != null ? `${num(r2(v.totalKeys))}<small> keys</small>` : '–', v.ratio != null ? `${pct(v.ratio)} of it pure` : '')}
                    ${stat('Items in stock', num(inv.itemCopies), s.items != null ? `${num(s.items)} different items` : '', '#bots/stock')}
                    ${stat('Listings', `${num(l.totals?.sell)}<small> sell</small>`, `${num(l.totals?.buy)} buy, synced ${ago(l.lastSync)}`, '#bots/listings')}
                    ${stat('Trades', num(t.trades24h), `last 24 h, ${num(t.sentOffers)} offers open`, '#bots/trading')}
                </div>
                <div class="admin-grid">
                    <div class="admin-card">
                        <h3>Trading</h3>
                        <ul class="admin-rows">
                            <li><span>Incoming offers</span>${pill(sw.incoming, 'On', 'Off')}</li>
                            <li><span>Trades from the site</span>${pill(sw.site, 'On', 'Off')}</li>
                            <li><span>Chat commands</span>${pill(sw.chat, 'On', 'Off')}</li>
                            <li><span>Waiting to be sent</span><strong>${num(t.queue)}</strong></li>
                            <li><span>Waiting for new prices to be accepted</span><strong>${num(t.approvals)}</strong></li>
                            <li><span>Waiting for mobile confirmation</span><strong>${num(t.confirmations)}</strong></li>
                        </ul>
                        <a class="admin-link" href="#bots/trading">Trading →</a>
                    </div>
                    <div class="admin-card">
                        <h3>Stock</h3>
                        <ul class="admin-rows">
                            <li><span>Buying</span>${s.paused ? pill(false, '', 'Paused') : pill(true, s.enabled === false ? 'On, fixed limits' : 'On')}</li>
                            <li><span>Pure share of the value</span><strong>${pct(s.metrics?.ratio)} <span class="muted">aim ${pct(s.targetPureRatio)}</span></strong></li>
                            <li><span>Buy pace</span><strong>${s.buyPace != null ? pct(s.buyPace) : '–'}</strong></li>
                            <li><span>Full groups</span><strong>${num(s.fullGroups)}${s.heldGroups ? ` <span class="muted">${num(s.heldGroups)} selling down</span>` : ''}</strong></li>
                            <li><span>Limits worked out</span><strong>${ago(s.lastRun)}</strong></li>
                        </ul>
                        ${s.flow?.text ? `<p class="admin-help">${esc(s.flow.text)}</p>` : ''}
                        <a class="admin-link" href="#bots/stock">Stock →</a>
                    </div>
                    <div class="admin-card">
                        <h3>bot_manager</h3>
                        <ul class="admin-rows">
                            <li><span>Running for</span><strong>${o.uptimeSec != null ? uptime(o.uptimeSec) : '–'}</strong></li>
                            <li><span>Memory</span><strong>${num(o.memoryMB)} MB</strong></li>
                            <li><span>Listings</span>${l.paused ? pill(false, '', 'Paused') : l.syncing ? pill(true, 'Syncing') : pill(l.started, 'Running', 'Not started')}</li>
                            <li><span>Blacklisted users</span><a href="#bots/blacklist"><strong>${num(o.blacklisted)}</strong></a></li>
                        </ul>
                        <div class="admin-bm-actions">
                            ${act('admin:key_price:refresh', {}, 'Update key price', { ok: 'Key price updated from backpack.tf.' })}
                            ${act('admin:prices:refresh', {}, 'Reload item prices', { ok: 'Item prices reloaded from the database.' })}
                        </div>
                    </div>
                    <div class="admin-card">
                        <h3>Recent changes</h3>
                        <p class="muted">What admins changed in bot_manager since it started.</p>
                        ${audit(log)}
                    </div>
                </div>`
        }
        actions(box, draw)
        await draw()
        ctx.watch(null, draw)
        ctx.every(20000, draw)
    }

    /* ========================= BOTS ========================= */

    const bot_state = (a) => a.stopping ? ['warn', 'Logging off']
        : a.loginError && !a.online ? ['bad', 'Login failed']
        : a.loggingIn ? ['warn', 'Logging in']
        : a.online ? (a.paused ? ['warn', 'Paused'] : ['ok', 'Online'])
        : (a.status == 'disabled' || a.enabled === false) ? ['off', 'Disabled']
        : a.status == 'pending' ? ['warn', 'Not logged in yet']
        : a.notRunning == 'not_started' ? ['warn', 'Not started'] : ['bad', 'Offline']

    const bot_card = (a, b) => {
        const [cls, label] = bot_state(a)
        const steamid = a.steamid || b?.steamid
        const inv = b?.inventory || a.inventory || {}
        const running = Boolean(b) || a.running
        const disabled = a.status == 'disabled' || a.enabled === false
        const name = a.name || b?.name || a.accountName
        return `<article class="admin-card admin-bm-bot" data-account="${esc(a.accountName)}" data-steamid="${esc(steamid || '')}">
            <div class="admin-bm-bot-head">
                ${b?.avatar ? `<img src="${esc(b.avatar)}" alt="" width="44" height="44" loading="lazy">` : '<span class="admin-bm-avatar" aria-hidden="true"></span>'}
                <div><strong>${steamid ? profile(steamid, name) : esc(name)}</strong>
                    <span class="muted">${esc(a.accountName)}, ${a.type == 'warehouse' ? 'warehouse' : 'trade'} bot${(a.level ?? b?.level) != null ? `, level ${num(a.level ?? b?.level)}` : ''}</span></div>
                <span class="admin-pill ${cls}"><i></i>${label}</span>
            </div>
            ${a.loginError && !a.online ? `<p class="admin-error">${esc(a.loginError.message || 'Steam refused the login')}${a.loginError.eresult ? ` (EResult ${esc(a.loginError.eresult)})` : ''}, ${ago(a.loginError.at)}</p>` : ''}
            ${a.stopping ? `<p class="admin-note">Logs off ${a.stopping.until ? later(a.stopping.until) : 'soon'}${a.stopping.openOffers ? `, once its ${num(a.stopping.openOffers)} open offer${a.stopping.openOffers == 1 ? ' is' : 's are'} done` : ''}.</p>` : ''}
            ${facts([
                ['Backpack', `${num(inv.total)} / ${num(inv.slots)}`],
                ['Items', num(inv.items)],
                ['Pure', `${num(inv.keys)} keys, ${num(inv.ref)} ref`],
                ['Listings', `${num(a.listings?.sell ?? b?.listings?.sell)} sell, ${num(a.listings?.buy ?? b?.listings?.buy)} buy${b?.listings?.slots ? ` <span class="muted">of ${num(b.listings.slots)}</span>` : ''}`],
                b && ['Sent offers', `${num(b.offers?.sent)} / ${num(b.offers?.limit)}${b.offers?.limitOverride != null ? ' <span class="admin-tag">set by hand</span>' : ''}`],
                b && ['Web session', b.webSession ? 'OK' : '<span class="admin-error">missing</span>'],
                a.type != 'warehouse' && !a.hasBptfToken && ['backpack.tf', '<span class="admin-error">no token</span>'],
                b?.inventory?.resync?.lastError && ['Inventory reload', `<span class="admin-error">${esc(b.inventory.resync.lastError)}</span>`]
            ])}
            <div class="admin-bm-actions">
                ${b ? `${act('admin:bots:pause', { steamid, paused: !b.paused }, b.paused ? 'Resume' : 'Pause', b.paused ? { ok: `${name} trades again.` } : { confirm: `Pause ${name}? It makes no new trades or listings; offers sent to it wait.`, ok: `${name} is paused.` })}
                    <button type="button" data-offer-limit="${esc(steamid)}" data-current="${esc(b.offers?.limitOverride ?? '')}">Offer limit</button>
                    ${act('admin:bots:relog', { steamid }, 'Log in again', { confirm: `Log ${name} off and on again?`, ok: 'Logging in again.' })}
                    ${act('admin:bots:web_relog', { steamid }, 'New web session', { ok: 'New web session requested.' })}
                    ${act('admin:bots:resync_inventory', { steamid }, 'Reload inventory', { ok: 'Inventory reloaded from Steam.' })}
                    ${a.type != 'warehouse' ? act('admin:bots:bptf_refresh', { steamid }, 'Refresh on backpack.tf', { ok: 'backpack.tf asked to load the inventory again.' }) : ''}` : ''}
                ${disabled || (!running && !a.stopping) || a.stopping ? act('admin:bots:enable', { bot: a.accountName }, a.stopping ? 'Keep it running' : 'Enable and log in', { cls: 'primary', ok: `${name} is logging in.` }) : ''}
                ${disabled && !running && !a.stopping ? `<button type="button" data-remove-bot="${esc(a.accountName)}">Remove</button>` : ''}
            </div>
            ${!disabled && !a.stopping ? `<details class="admin-bm-disable"><summary>Disable this bot…</summary>
                <p class="admin-help">It stops trading now and its listings come down. It logs off once its open sent offers are done, then its items and pure leave the stock. It isn't started again after a restart.</p>
                <label class="check"><input type="checkbox" name="cancel"> Cancel its open sent offers now</label>
                <label class="admin-field">Wait for open offers at most <span class="admin-input-unit"><input type="number" name="wait" min="1" max="120" value="35"><em>min</em></span></label>
                <button type="button" data-disable-bot="${esc(a.accountName)}">Disable ${esc(name)}</button>
            </details>` : ''}
        </article>`
    }

    const SECRET_FIELDS = [
        ['password', 'Steam password', 'The Steam account\'s password'],
        ['sharedSecret', 'Shared secret', 'shared_secret from the .maFile (base64)'],
        ['identitySecret', 'Identity secret', 'identity_secret from the .maFile (base64)'],
        ['bptf_key', 'backpack.tf API key', 'trade bots only'],
        ['bptf_token', 'backpack.tf access token', 'trade bots only']
    ]
    const secret_inputs = (required) => SECRET_FIELDS.map(([name, label, hint]) => `<label class="admin-field">${label}
        <input type="password" name="${name}" autocomplete="new-password" spellcheck="false"${required && name != 'bptf_key' && name != 'bptf_token' ? ' required' : ''}>
        <span class="admin-help">${hint}</span></label>`).join('')

    const tab_bots = async (box, ctx) => {
        box.innerHTML = `<div id="bm-bots">${loading}</div>
            <div class="admin-settings admin-bm-forms">
                <form class="admin-card" id="bm-add-bot" autocomplete="off">
                    <h3>Add a bot</h3>
                    <p class="muted">The login is saved encrypted in bot_manager's database and never shown again. Nothing typed here is kept by the site.</p>
                    <label class="admin-field">Steam account name <input type="text" name="accountName" required maxlength="64" spellcheck="false" autocomplete="off"></label>
                    ${secret_inputs(true)}
                    <div class="admin-row-fields">
                        <label class="admin-field">Kind <select name="type"><option value="trade">Trade bot</option><option value="warehouse">Warehouse</option></select></label>
                        <div class="admin-field">Start
                            <label class="check"><input type="checkbox" name="enabled" checked> Enabled</label>
                            <label class="check"><input type="checkbox" name="start" checked> Log in now</label>
                        </div>
                    </div>
                    <div class="admin-card-foot"><button type="submit" class="primary">Add bot</button></div>
                </form>
                <form class="admin-card" id="bm-login" autocomplete="off">
                    <h3>Change a bot's login</h3>
                    <p class="muted">Fill in only what changes. backpack.tf key and token apply now, the rest at the bot's next login (disable and enable it to log in now).</p>
                    <label class="admin-field">Bot <select name="bot" required><option value="">Pick a bot</option></select></label>
                    ${secret_inputs(false)}
                    <label class="admin-field">Kind <select name="type"><option value="">Keep it</option><option value="trade">Trade bot</option><option value="warehouse">Warehouse</option></select></label>
                    <div class="admin-card-foot"><button type="submit" class="primary">Save login</button></div>
                </form>
            </div>`
        const list = box.querySelector('#bm-bots')

        const draw = async () => {
            const [acc, run] = await Promise.all([bm('admin:bots:accounts'), bm('admin:bots:list')])
            if(!box.isConnected){ return }
            if(acc.status != 'ok'){ return failed(box, acc) }
            const live = new Map((run.status == 'ok' ? run.data : []).map((b) => [String(b.steamid), b]))
            const accounts = acc.data?.accounts || []
            const running = Array.isArray(acc.data?.running) ? acc.data.running.length : acc.data?.running
            // bots running that aren't in the accounts list (an older bot_manager) still get a card
            const extra = [...live.values()].filter((b) => !accounts.some((a) => String(a.steamid) == String(b.steamid)))
                .map((b) => ({ accountName: b.accountName || b.name, name: b.name, steamid: b.steamid, type: b.type, online: b.online, paused: b.paused, running: true, enabled: true }))
            list.innerHTML = `<div class="admin-card admin-bm-max">
                    <div><h3>Bots running at once</h3>
                    <p class="muted">${num(running)} running now. bot_manager logs in the enabled bots with the lowest IDs up to this number.</p></div>
                    <form class="admin-inline-form" id="bm-max">
                        <span class="admin-input-unit"><input type="number" name="max" min="1" max="${esc(acc.data?.hardMax ?? 12)}" value="${esc(acc.data?.maxBots ?? '')}" aria-label="Bots running at once"><em>of ${esc(acc.data?.hardMax ?? 12)}</em></span>
                        <button type="submit">Save</button>
                        ${act('admin:bots:max', { max: null }, 'Use .env value', { ok: 'Max bots comes from MAX_BOTS in .env again.' })}
                    </form>
                </div>
                <div class="admin-bm-bots">${[...accounts, ...extra].map((a) => bot_card(a, live.get(String(a.steamid)))).join('') || '<p class="admin-empty">No bot accounts yet. Add one below.</p>'}</div>`
            const select = box.querySelector('#bm-login [name="bot"]')
            const picked = select.value
            select.innerHTML = '<option value="">Pick a bot</option>' + accounts.map((a) => `<option value="${esc(a.accountName)}">${esc(a.name || a.accountName)} (${esc(a.accountName)})</option>`).join('')
            select.value = picked
        }

        actions(box, draw)
        box.addEventListener('submit', async (e) => {
            const form = e.target
            e.preventDefault()
            const btn = form.querySelector('[type="submit"]')
            if(form.id == 'bm-max'){
                const res = await busy(btn, () => bm('admin:bots:max', { max: Number(form.max.value) }))
                if(toast(res, `Up to ${num(form.max.value)} bots run at once.`)){ draw() }
            }
            if(form.id == 'bm-add-bot'){
                const payload = { accountName: form.accountName.value.trim(), type: form.type.value, enabled: form.enabled.checked, start: form.start.checked }
                for (const [name] of SECRET_FIELDS) { if(form[name].value.trim()){ payload[name] = form[name].value.trim() } }
                if(payload.type == 'trade' && (!payload.bptf_key || !payload.bptf_token) && !confirm('Trade bots need a backpack.tf API key and access token to list items. Add the bot without them?')){ return }
                const res = await busy(btn, () => bm('admin:bots:add', payload))
                if(toast(res, res.data?.started ? 'Bot added and logging in.' : `Bot added${res.data?.reason ? `, not started: ${esc(words(res.data.reason))}` : ''}.`)){ form.reset(); draw() }
            }
            if(form.id == 'bm-login'){
                const payload = { bot: form.bot.value }
                for (const [name] of SECRET_FIELDS) { if(form[name].value.trim()){ payload[name] = form[name].value.trim() } }
                if(form.type.value){ payload.type = form.type.value }
                if(Object.keys(payload).length == 1){ return iziToast.info({ title: 'Nothing to save', message: 'Fill in what changes.' }) }
                const res = await busy(btn, () => bm('admin:bots:update', payload))
                const now = Array.isArray(res.data?.appliedNow) ? res.data.appliedNow : []
                const next = Array.isArray(res.data?.nextLogin) ? res.data.nextLogin : []
                if(toast(res, `Saved.${now.length ? ` Used now: ${esc(now.join(', '))}.` : ''}${next.length ? ` At its next login: ${esc(next.join(', '))}.` : ''}`)){ form.reset(); draw() }
            }
        })
        box.addEventListener('click', async (e) => {
            const limit = e.target.closest('[data-offer-limit]')
            if(limit){
                const value = prompt('Most sent offers this bot keeps open at once. Empty = the default (30).', limit.dataset.current)
                if(value === null){ return }
                if(value.trim() !== '' && !(Number(value) >= 1)){ return iziToast.error({ title: 'Error', message: 'Enter a number from 1, or nothing for the default.' }) }
                const res = await busy(limit, () => bm('admin:bots:offer_limit', { steamid: limit.dataset.offerLimit, limit: value.trim() === '' ? null : Number(value) }))
                if(toast(res, 'Offer limit saved.')){ draw() }
            }
            const remove = e.target.closest('[data-remove-bot]')
            if(remove){
                const typed = prompt(`Delete the account ${remove.dataset.removeBot} from bot_manager? Its saved login is deleted too. Type the account name to confirm.`)
                if(typed === null){ return }
                const res = await busy(remove, () => bm('admin:bots:remove', { bot: remove.dataset.removeBot, confirm: typed.trim() }))
                if(toast(res, 'Bot account removed.')){ draw() }
            }
            const disable = e.target.closest('[data-disable-bot]')
            if(disable){
                const form = disable.closest('details')
                const res = await busy(disable, () => bm('admin:bots:disable', { bot: disable.dataset.disableBot, cancelOffers: form.querySelector('[name="cancel"]').checked, waitMin: Number(form.querySelector('[name="wait"]').value) || 35 }))
                if(toast(res, res.data?.stopping ? `Disabled. It logs off ${later(res.data.logsOffBy)}.` : 'Disabled.')){ draw() }
            }
        })

        await draw()
        ctx.watch(['bots'], draw)
        ctx.every(30000, () => { if(!box.querySelector('details[open], form :focus')){ draw() } })
    }

    /* ========================= TRADING ========================= */

    const side_text = (s) => {
        if(!s){ return '–' }
        const items = Array.isArray(s.items) ? s.items : []
        const names = items.slice(0, 3).map((i) => `${esc(i.name || i.bp_sku)}${i.count > 1 ? ` ×${num(i.count)}` : ''}`)
        if(items.length > 3){ names.push(`${num(items.length - 3)} more`) }
        if(Array.isArray(s.other) && s.other.length){ names.push(`${num(s.other.length)} unpriced`) }
        const pure = [s.keys ? `${num(s.keys)} key${s.keys == 1 ? '' : 's'}` : '', s.metal ? ref(s.metal) : ''].filter(Boolean)
        const text = [...names, ...pure].join(', ')
        return `${text || '–'}${s.valueKeys != null ? `<span class="admin-help">${keys(s.valueKeys)}</span>` : ''}`
    }
    const queue_rows = (list, buttons) => list.map((t) => `<tr>
        <td>${profile(t.partner)}</td>
        <td>${words(t.source)}</td>
        <td>${num(t.siteItems)} ours, ${num(t.userItems)} theirs</td>
        <td>${t.metal ? `${ref(Math.abs(t.metal))}${t.keys != null ? ` <span class="muted">${keys(Math.abs(t.keys))}</span>` : ''}${t.metalGiver ? ` <span class="muted">from ${words(t.metalGiver)}</span>` : ''}` : '–'}</td>
        <td>${t.time ? ago(t.time) : '–'}${Array.isArray(t.priceChanges) && t.priceChanges.length ? `<span class="admin-help">${num(t.priceChanges.length)} price${t.priceChanges.length == 1 ? '' : 's'} changed</span>` : ''}</td>
        <td class="admin-bm-cell-actions">${buttons(t)}</td></tr>`)

    const tab_trading = async (box, ctx) => {
        box.innerHTML = `<div class="admin-settings">
                <div class="admin-card" id="bm-switches">${loading}</div>
                <div class="admin-card" id="bm-trade-counts">${loading}</div>
            </div>
            <div class="admin-settings admin-bm-stack" id="bm-rules"></div>
            <div class="admin-settings admin-bm-stack">
                <div class="admin-card wide"><h3>Waiting to be sent</h3><div id="bm-queue">${loading}</div></div>
                <div class="admin-card wide"><h3>Waiting for the user to accept new prices</h3><div id="bm-approvals">${loading}</div></div>
                <div class="admin-card wide"><h3>Offers we sent</h3><p class="muted">Still open or being made.</p><div id="bm-offers">${loading}</div></div>
                <div class="admin-card"><h3>Incoming offers waiting</h3><p class="muted">On a paused bot, with incoming offers off, or while the inventory loads.</p><div id="bm-pending">${loading}</div></div>
                <div class="admin-card"><h3>Incoming offers ignored</h3><p class="muted">Wrong value, stock limit, unknown items and so on.</p><div id="bm-ignored">${loading}</div></div>
                <div class="admin-card wide"><h3>Recent trades</h3>
                    <form class="admin-inline-form" id="bm-recent-form"><input type="search" name="steamid" placeholder="Only trades with this SteamID64" inputmode="numeric" maxlength="17"><button type="submit">Show</button></form>
                    <div id="bm-recent">${loading}</div></div>
            </div>`
        const $ = (sel) => box.querySelector(sel)
        const rules = settings_card($('#bm-rules'), {
            title: 'Incoming offer rules',
            intro: 'How bot_manager judges trade offers users send to the bots.',
            help: HELP.offers,
            load: async () => { const r = await bm('admin:trading:status'); return r.status == 'ok' ? { status: 'ok', data: { config: r.data.offerRules, defaults: r.data.offerRuleDefaults } } : r },
            save: (rules) => bm('admin:trading:offer_rules', { rules }),
            reset: () => bm('admin:trading:offer_rules:reset')
        })

        const SWITCHES = [['incoming', 'Incoming offers', 'Trade offers users send to the bots. Off: they wait (moves between our bots still work).'],
            ['site', 'Trades from the site', 'Trades users make on tf2deal.com.'], ['chat', 'Chat commands', '!buy and !sell in Steam chat.']]
        const draw_status = async () => {
            const res = await bm('admin:trading:status')
            if(!box.isConnected){ return }
            if(res.status != 'ok'){ return failed(box, res) }
            const s = res.data || {}, sw = s.switches || {}
            $('#bm-switches').innerHTML = `<h3>Trading</h3><ul class="admin-rows">${SWITCHES.map(([key, label, help]) => `<li>
                <span>${label}<span class="admin-help">${help}</span></span>
                <span class="row-end">${pill(sw[key], 'On', 'Off')}<label class="admin-switch"><input type="checkbox" data-switch="${key}" ${sw[key] ? 'checked' : ''} aria-label="${label}"><span></span></label></span></li>`).join('')}</ul>`
            $('#bm-trade-counts').innerHTML = `<h3>Right now</h3><ul class="admin-rows">
                <li><span>Waiting to be sent</span><strong>${num(s.queue)}</strong></li>
                <li><span>Waiting for new prices to be accepted</span><strong>${num(s.approvals)}</strong></li>
                <li><span>Waiting for mobile confirmation</span><strong>${num(s.confirmations)}</strong></li>
                <li><span>Sent offers open</span><strong>${num(s.sentOffers)}</strong></li>
                <li><span>Incoming offers ignored</span><strong>${num(s.ignoredOffers)}</strong></li>
                <li><span>Trades, last 24 h</span><strong>${num(s.trades24h)}</strong></li></ul>`
        }

        const draw_lists = async () => {
            const [queue, approvals, offers, pending, ignored] = await Promise.all(['queue', 'approvals', 'offers', 'pending', 'ignored'].map((n) => bm(`admin:trading:${n}`)))
            if(!box.isConnected){ return }
            const cols = ['User', 'From', 'Items', 'Pure', 'Since', '']
            $('#bm-queue').innerHTML = queue.status != 'ok' ? error_line(queue) : table(cols, queue_rows(queue.data || [], (t) => act('admin:trading:queue:remove', { steamid: t.partner }, 'Drop', { confirm: 'Drop this trade? The user has to start it again.', ok: 'Trade dropped.' })), 'No trade is waiting.')
            $('#bm-approvals').innerHTML = approvals.status != 'ok' ? error_line(approvals) : table(cols, queue_rows(approvals.data || [], (t) => `${act('admin:trading:approve', { steamid: t.partner }, 'Send it', { cls: 'primary', ok: 'Approved, the offer is being sent.' })} ${act('admin:trading:deny', { steamid: t.partner }, 'Drop', { ok: 'Trade dropped.' })}`), 'No trade waits for new prices.')
            $('#bm-offers').innerHTML = offers.status != 'ok' ? error_line(offers) : table(['User', 'State', 'Offer', 'Bot', 'Made', ''], (offers.data || []).map((o) => `<tr>
                <td>${profile(o.partner)}</td><td>${words(o.status)}</td>
                <td>${o.offerID ? `<a href="https://steamcommunity.com/tradeoffer/${esc(o.offerID)}/" target="_blank" rel="noopener nofollow">${esc(o.offerID)}</a>` : '<span class="muted">being made</span>'}</td>
                <td>${esc(o.botName || o.bot || '–')}</td><td>${o.created ? ago(o.created) : '–'}</td>
                <td class="admin-bm-cell-actions">${o.offerID || o.partner ? act('admin:trading:offer:cancel', o.offerID ? { offerID: o.offerID, ...(o.bot ? { bot: o.bot } : {}) } : { steamid: o.partner }, 'Cancel', { confirm: 'Cancel this offer on Steam?', ok: 'Offer cancelled.' }) : ''}</td></tr>`), 'No open offers.')
            const waiting = pending.status == 'ok' ? (pending.data || []).filter((b) => b.offers?.length) : []
            $('#bm-pending').innerHTML = pending.status != 'ok' ? error_line(pending) : waiting.length ? waiting.map((b) => `<h4 class="admin-bm-sub">${esc(b.name || b.steamid)}</h4>
                <div class="admin-chips">${b.offers.map((id) => `<span class="admin-chip">${esc(id)} ${act('admin:trading:offer:reprocess', { bot: b.steamid, offerID: String(id) }, '↻', { ok: 'Checked again.' }).replace('<button', '<button title="Check this offer again" aria-label="Check offer again"')}</span>`).join('')}</div>`).join('') : '<p class="admin-empty">None waiting.</p>'
            $('#bm-ignored').innerHTML = ignored.status != 'ok' ? error_line(ignored) : table(['Offer', 'User', 'Forgotten'], (ignored.data || []).map((o) => `<tr><td>${esc(o.offerID)}</td><td>${profile(o.steamid)}</td><td>${o.expires ? later(o.expires) : '–'}</td></tr>`), 'None ignored.')
        }

        let recent_filter = '', recent_rows = []
        const draw_recent = async (before) => {
            const res = await bm('admin:trading:recent', { limit: 10, ...(recent_filter ? { steamid: recent_filter } : {}), ...(before ? { before } : {}) })
            if(!box.isConnected){ return }
            const el = $('#bm-recent')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const trades = res.data?.trades || []
            recent_rows = (before ? recent_rows : []).concat(trades.map((t) => `<tr>
                <td>${t.time ? when(t.time) : esc(t.date || '')}</td><td>${t.internal ? '<span class="admin-tag">between bots</span>' : profile(t.partner)}</td>
                <td>${esc(t.botName || t.bot || '–')}</td><td>${side_text(t.gave)}</td><td>${side_text(t.got)}</td></tr>`))
            el.innerHTML = table(['When', 'User', 'Bot', 'User got', 'User gave'], recent_rows, 'No trades saved yet.') +
                (res.data?.next ? `<div class="admin-pager"><button type="button" data-more="${esc(res.data.next)}">Show more</button></div>` : '')
        }
        $('#bm-recent-form').addEventListener('submit', (e) => {
            e.preventDefault()
            const value = e.target.steamid.value.trim()
            if(value && !/^\d{17}$/.test(value)){ return iziToast.error({ title: 'Error', message: 'That is not a SteamID64 (17 digits).' }) }
            recent_filter = value
            draw_recent()
        })
        box.addEventListener('click', (e) => { const more = e.target.closest('[data-more]'); if(more){ busy(more, () => draw_recent(more.dataset.more)) } })
        box.addEventListener('change', async (e) => {
            const sw = e.target.closest('[data-switch]')
            if(!sw){ return }
            if(!sw.checked && !confirm(`Turn ${SWITCHES.find(([k]) => k == sw.dataset.switch)[1].toLowerCase()} off?`)){ sw.checked = true; return }
            const res = await bm('admin:trading:switches', { [sw.dataset.switch]: sw.checked })
            if(!toast(res, 'Saved.')){ sw.checked = !sw.checked }
            draw_status()
        })
        actions(box, () => { draw_status(); draw_lists() })

        await Promise.all([draw_status(), draw_lists(), rules.load(), draw_recent()])
        ctx.watch(['trading'], () => { draw_status(); draw_lists(); rules.changed() })
        ctx.every(15000, () => { draw_status(); draw_lists() })
    }

    /* ========================= STOCK ========================= */

    const GROUP_SORTS = [['value', 'Value'], ['count', 'In stock'], ['limit', 'Limit'], ['headroom', 'Room left'], ['score', 'Score'], ['sold', 'Sold per day'], ['fill', 'How full']]
    const group_state = (g) => [
        g.held ? `<span class="admin-tag tag-warn" title="Full: nothing of it is bought until it sells down">selling down to ${num(g.held.resumeAtCount)}</span>` : '',
        g.blocked ? '<span class="admin-tag tag-bad">blocked</span>' : '',
        g.waitsForPure ? `<span class="admin-tag tag-warn">waits for ${keys(g.waitsForPure.needsPureKeys)} pure</span>` : '',
        g.override ? '<span class="admin-tag">set by hand</span>' : '',
        g.full && !g.held ? '<span class="admin-tag tag-warn">full</span>' : ''
    ].join(' ')
    const number_input = (name, value, label, unit, help) => `<label class="admin-field">${label}
        <span class="admin-input-unit${unit ? '' : ' no-unit'}"><input type="number" name="${name}" step="any" min="0" value="${esc(value ?? '')}" placeholder="automatic">${unit ? `<em>${unit}</em>` : ''}</span>
        ${help ? `<span class="admin-help">${help}</span>` : ''}</label>`

    const tab_stock = async (box, ctx) => {
        box.innerHTML = `<div id="bm-stock-status">${loading}</div>
            <div class="admin-settings admin-bm-stack">
                <div class="admin-card wide">
                    <h3>Groups</h3>
                    <p class="muted">Items are limited per group (quality and type, unusuals also per effect) and per item. Open a group to see its items and set its limit by hand.</p>
                    <form class="admin-bm-filters" id="bm-groups-form">
                        <label class="admin-field">Search <input type="search" name="search" placeholder="e.g. cosmetic, 5|taunt" maxlength="60"></label>
                        <label class="admin-field">Quality <select name="quality"><option value="">Any</option>${Object.entries(QUALITY_NAMES).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></label>
                        <label class="admin-field">Sort <select name="sort">${GROUP_SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
                        <div class="admin-bm-checks">
                            <label class="check"><input type="checkbox" name="onlyStocked" checked> In stock</label>
                            <label class="check"><input type="checkbox" name="onlyFull"> Full</label>
                            <label class="check"><input type="checkbox" name="onlyOverridden"> Set by hand</label>
                        </div>
                        <button type="submit" class="primary">Show</button>
                    </form>
                    <div id="bm-groups">${loading}</div>
                </div>
                <div class="admin-card">
                    <h3>One item</h3>
                    <p class="muted">How an item's limit was worked out, and a limit of its own.</p>
                    <form class="admin-inline-form" id="bm-item-form"><input type="search" name="bp_sku" placeholder="Item name, e.g. Team Captain" required maxlength="200"><button type="submit">Look up</button></form>
                    <div id="bm-item"></div>
                </div>
                <div class="admin-card">
                    <h3>Would the bots buy these?</h3>
                    <p class="muted">One item per line, optionally with how many (Team Captain x3). Nothing is bought.</p>
                    <form id="bm-sim-form"><textarea name="items" rows="4" required placeholder="Team Captain x3&#10;Mann Co. Supply Crate Key"></textarea>
                        <div class="admin-card-foot"><button type="submit">Check</button></div></form>
                    <div id="bm-sim"></div>
                </div>
                <div class="admin-card"><h3>Buy / sell balance</h3><div id="bm-flow">${loading}</div></div>
                <div class="admin-card"><h3>Promised in offers</h3><p class="muted">Items in accepted or sent offers count against the limits until the trade ends.</p><div id="bm-res">${loading}</div></div>
                <div class="admin-card wide">
                    <h3>What sells</h3>
                    <form class="admin-inline-form" id="bm-sellers-form">
                        <input type="search" name="search" placeholder="Item name" maxlength="100">
                        <select name="sort" aria-label="Sort"><option value="profit">Profit per week</option><option value="sales">Sales per week</option><option value="factor">Sales factor</option><option value="stock">Not selling</option></select>
                        <button type="submit">Show</button>
                    </form>
                    <div id="bm-sellers">${loading}</div>
                </div>
                <div class="admin-card wide"><h3>Limits set by hand</h3><div id="bm-overrides">${loading}</div></div>
            </div>
            <div class="admin-settings admin-bm-stack" id="bm-stock-settings"></div>`
        const $ = (sel) => box.querySelector(sel)
        const settings = settings_card($('#bm-stock-settings'), {
            title: 'Stock settings', help: HELP.stock, ...scope_settings('stock'),
            intro: 'How bot_manager works out the limits. Saving works the limits out again a second later.'
        })

        const draw_status = async (pushed) => {
            const res = pushed ? { status: 'ok', data: pushed } : await bm('admin:stock:status')
            if(!box.isConnected){ return }
            if(res.status != 'ok'){ return failed(box, res) }
            const s = res.data || {}, m = s.metrics || {}
            $('#bm-stock-status').innerHTML = `<div class="admin-bm-toolbar">
                    <span>${s.paused ? pill(false, '', 'Buying paused') : pill(true, s.enabled === false ? 'Buying, fixed limits only' : 'Buying')}${s.running ? ' <span class="admin-tag">working out limits…</span>' : ''}</span>
                    <span class="admin-bm-actions">
                        ${s.paused ? act('admin:stock:pause', { paused: false }, 'Resume buying', { cls: 'primary', ok: 'Buying again.' }) : act('admin:stock:pause', { paused: true }, 'Pause buying', { confirm: 'Stop buying anything? Selling goes on and the buy listings come down.', ok: 'Buying paused.' })}
                        ${act('admin:stock:recompute', {}, 'Work out limits now', { ok: 'Limits worked out again.' })}
                    </span>
                </div>
                <div class="admin-stats">
                    ${stat('Pure share', pct(m.ratio), `aim ${pct(s.targetPureRatio)}, ${keys(m.pureKeys)} of ${keys(m.totalKeys)}`)}
                    ${stat('Limits at', s.pressure != null ? `${num(Math.round(s.pressure * 100))}<small> %</small>` : '–', 'of their healthy size (pure pressure)')}
                    ${stat('Buy pace', s.buyPace != null ? `${num(Math.round(s.buyPace * 100))}<small> %</small>` : '–', s.flow?.ratio != null ? `bought ÷ sold ${num(r2(s.flow.ratio))}` : 'not enough trades to judge')}
                    ${stat('Groups', num(s.stockedGroups), `in stock; ${num(s.fullGroups)} full, ${num(s.heldGroups)} selling down`)}
                    ${stat('Items', num(s.itemCopies), `${num(s.items)} different, ${num(s.reservations)} promised`)}
                    ${stat('Set by hand', num((s.overrides?.groups || 0) + (s.overrides?.skus || 0)), `${num(s.overrides?.groups)} groups, ${num(s.overrides?.skus)} items`)}
                    ${stat('Worked out', ago_stat(s.lastRun), s.nextRun ? `next ${later(s.nextRun)}` : '')}
                </div>
                ${s.flow?.text ? `<p class="admin-note">${esc(s.flow.text)}</p>` : ''}
                ${s.lastError ? `<p class="admin-error">The last run failed: ${esc(s.lastError)}</p>` : ''}`
        }

        /* groups */
        let query = { onlyStocked: true, sort: 'value', page: 0 }
        const open_groups = new Set()
        const draw_groups = async () => {
            const res = await bm('admin:stock:groups', { ...query, order: 'desc', limit: 50 })
            if(!box.isConnected){ return }
            const el = $('#bm-groups')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const d = res.data || {}, pages = Math.max(1, Math.ceil((d.total || 0) / (d.limit || 50)))
            el.innerHTML = table(['Group', 'In stock', 'Limit', 'Room', 'Value', 'Sold / day', 'Score', ''], (d.groups || []).map((g) => `<tr class="admin-bm-group-row" data-group="${esc(g.key)}" tabindex="0" aria-expanded="${open_groups.has(g.key)}">
                    <td><strong>${group_name(g.key)}</strong><span class="admin-help">${esc(g.key)}</span></td>
                    <td>${num(g.count)}${g.reserved ? ` <span class="muted">+${num(g.reserved)}</span>` : ''}</td>
                    <td>${num(g.limit)}${g.fullLimit != null && g.fullLimit != g.limit ? ` <span class="muted" title="Without the buy pace">of ${num(g.fullLimit)}</span>` : ''}</td>
                    <td>${num(g.headroom)}</td>
                    <td>${keys(g.valueKeys)}<span class="admin-help">cap ${keys(g.valueCapKeys)}</span></td>
                    <td>${num(r2(g.soldPerDay))}</td><td>${num(r2(g.score))}</td><td>${group_state(g)}</td></tr>
                    ${open_groups.has(g.key) ? `<tr class="admin-bm-detail" data-detail="${esc(g.key)}"><td colspan="8">${loading}</td></tr>` : ''}`), 'No group matches.') +
                (pages > 1 ? `<div class="admin-pager"><button type="button" data-page="${query.page - 1}" ${query.page <= 0 ? 'disabled' : ''}>Previous</button><span class="muted">Page ${query.page + 1} of ${pages}, ${num(d.total)} groups</span><button type="button" data-page="${query.page + 1}" ${query.page + 1 >= pages ? 'disabled' : ''}>Next</button></div>` : '')
            for (const key of open_groups) { draw_group(key) }
        }
        const draw_group = async (key) => {
            const res = await bm('admin:stock:group', { key })
            const cell = box.querySelector(`[data-detail="${CSS.escape(key)}"] td`)
            if(!cell){ return }
            if(res.status != 'ok'){ cell.innerHTML = error_line(res); return }
            const g = res.data?.group || {}, o = g.override || {}, b = res.data?.breakdown || {}
            cell.innerHTML = `<div class="admin-bm-group-detail">
                <form class="admin-bm-override" data-override="${esc(key)}">
                    <h4 class="admin-bm-sub">Set by hand</h4>
                    <div class="admin-row-fields">
                        ${number_input('limit', o.limit, 'Limit', 'items', `Worked out: ${num(g.target ?? g.limit)}`)}
                        ${number_input('valueCapKeys', o.valueCapKeys, 'Value cap', 'keys', `Worked out: ${keys(g.valueCapAtRecompute ?? g.valueCapKeys)}`)}
                        ${number_input('perSkuMax', o.perSkuMax, 'Most of one item', 'items', 'Empty: each item\'s own limit')}
                        <label class="admin-field">Note <input type="text" name="note" maxlength="200" value="${esc(o.note || '')}"></label>
                    </div>
                    <label class="check"><input type="checkbox" name="blocked" ${o.blocked ? 'checked' : ''}> Never buy anything of this group</label>
                    <div class="admin-bm-actions">
                        <button type="submit" class="primary">Save</button>
                        ${g.override ? act('admin:stock:group:clear', { key }, 'Back to automatic', { ok: 'The group\'s limits are automatic again.' }) : ''}
                        ${g.held ? act('admin:stock:group:resume', { key }, 'Buy again now', { ok: 'The group buys again.' }) : ''}
                    </div>
                </form>
                <div>
                    <h4 class="admin-bm-sub">How the limit was worked out</h4>
                    ${facts([
                        ['Measured against', g.basis == 'pure' ? 'pure' : 'total value'],
                        ['Sold / bought per day', `${num(r2(g.soldPerDay))} / ${num(r2(g.boughtPerDay))}`],
                        ['Sold, long term', num(g.longSold)],
                        ['Sell-through', pct(g.sellThrough)],
                        ['Days of stock', g.daysOfStock != null ? num(r2(g.daysOfStock)) : 'no sales'],
                        ['Buy pace', pct(g.pace)],
                        b.conf != null && ['Trust in own trades', pct(b.conf)],
                        b.capCount != null && ['Cap by value', num(b.capCount)],
                        b.coverCap != null && ['Cap by sales', num(b.coverCap)],
                        g.held && ['Selling down since', `${ago(g.held.since)}, buys again at ${num(g.held.resumeAtCount)} item${g.held.resumeAtCount == 1 ? '' : 's'}`]
                    ])}
                </div>
                <div class="wide">
                    <h4 class="admin-bm-sub">Items in stock</h4>
                    ${table(['Item', 'In stock', 'Limit', 'Room', 'Price', 'Bots'], (res.data?.items || []).map((i) => `<tr>
                        <td><button type="button" class="admin-bm-linkish" data-explain="${esc(i.bp_sku)}">${esc(i.bp_sku)}</button>${i.override ? ' <span class="admin-tag">set by hand</span>' : ''}</td>
                        <td>${num(i.count)}</td><td>${num(i.limit)}</td><td>${num(i.headroom)}</td><td>${keys(i.priceKeys)}</td><td>${num(Object.keys(i.owners || {}).length)}</td></tr>`), 'Nothing of this group in stock.')}
                </div>
            </div>`
        }
        const toggle_group = (row) => {
            const key = row.dataset.group
            if(open_groups.has(key)){
                open_groups.delete(key)
                row.nextElementSibling?.matches('.admin-bm-detail') && row.nextElementSibling.remove()
                row.setAttribute('aria-expanded', 'false')
                return
            }
            open_groups.add(key)
            row.setAttribute('aria-expanded', 'true')
            row.insertAdjacentHTML('afterend', `<tr class="admin-bm-detail" data-detail="${esc(key)}"><td colspan="8">${loading}</td></tr>`)
            draw_group(key)
        }

        /* one item */
        const explain = async (bp_sku) => {
            $('#bm-item-form').bp_sku.value = bp_sku
            const el = $('#bm-item')
            el.innerHTML = loading
            const res = await bm('admin:stock:item', { bp_sku })
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const d = res.data || {}, f = d.computed?.factors || {}
            el.innerHTML = `${facts([
                    ['Limit', `${num(d.limit)}${d.override ? ' <span class="admin-tag">set by hand</span>' : d.computed?.single ? ' <span class="muted">one per item</span>' : ''}`],
                    ['In stock', `${num(d.stock)}${d.reserved ? ` + ${num(d.reserved)} promised` : ''}, room for ${num(d.headroom)}`],
                    ['Price', keys(d.priceKeys)],
                    ['Group', d.group?.key ? group_name(d.group.key) : '–'],
                    ['backpack.tf', d.market ? `${num(d.market.buyorders)} buy orders, ${num(d.market.sellorders)} sell orders` : '–'],
                    ['Sold per week', d.sales ? num(r2(d.sales.soldPerWeek)) : '–'],
                    ['Traded', d.traded ? `${num(d.traded.in)} bought, ${num(d.traded.out)} sold` : '–'],
                    ['Factors', Object.entries(f).map(([k, v]) => `${esc(k)} ${num(r2(v))}`).join(', ') || '–']
                ])}
                <form class="admin-inline-form" data-item-override="${esc(d.bp_sku || bp_sku)}">
                    <span class="admin-input-unit"><input type="number" name="limit" min="0" step="1" value="${esc(d.override?.limit ?? '')}" placeholder="automatic" aria-label="Limit for this item"><em>max</em></span>
                    <button type="submit" class="primary">Set limit</button>
                    ${d.override ? act('admin:stock:item:clear', { bp_sku: d.bp_sku || bp_sku }, 'Automatic', { ok: 'The item\'s limit is automatic again.' }) : ''}
                </form>`
        }

        /* the rest */
        const draw_flow = async () => {
            const res = await bm('admin:stock:flow')
            if(!box.isConnected){ return }
            const el = $('#bm-flow')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const f = res.data || {}
            const cols = [['day', 'Last 24 h'], ['window', `Last ${num(f.days)} days`], ['saved', 'All saved']].filter(([k]) => f[k])
            const row = (label, fn) => `<tr><td>${label}</td>${cols.map(([k]) => `<td>${fn(f[k])}</td>`).join('')}</tr>`
            el.innerHTML = `${f.text ? `<p class="admin-help">${esc(f.text)}</p>` : ''}
                ${cols.length ? table(['', ...cols.map(([, l]) => l)], [
                    row('Trades buying', (w) => num(w.buy)), row('Trades selling', (w) => num(w.sell)), row('Exchanges', (w) => num(w.exchange)),
                    row('Items in', (w) => num(w.itemsIn)), row('Items out', (w) => num(w.itemsOut)),
                    row('Value in', (w) => keys(w.valueInKeys)), row('Value out', (w) => keys(w.valueOutKeys))]) : '<p class="admin-empty">No saved trades yet.</p>'}
                ${facts([['Bought ÷ sold', f.ratio != null ? num(r2(f.ratio)) : '–'], ['Buy pace', pct(f.pace)]])}`
        }
        const draw_res = async () => {
            const res = await bm('admin:stock:reservations')
            if(!box.isConnected){ return }
            const el = $('#bm-res')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            el.innerHTML = table(['User', 'Items', 'Since', ''], (res.data || []).map((r) => `<tr><td>${profile(r.owner)}</td>
                <td>${(r.items || []).map((i) => `${esc(i.bp_sku)}${i.n > 1 ? ` ×${num(i.n)}` : ''}`).join(', ')}</td><td>${ago(r.created)}</td>
                <td class="admin-bm-cell-actions">${act('admin:stock:release', { key: r.key }, 'Release', { confirm: 'Release these items? Only do it for an offer that is stuck.', ok: 'Released.' })}</td></tr>`), 'Nothing promised.')
        }
        let seller_query = { sort: 'profit' }
        const draw_sellers = async () => {
            const res = await bm('admin:stock:sellers', { ...seller_query, limit: 50 })
            if(!box.isConnected){ return }
            const el = $('#bm-sellers')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const d = res.data || {}
            el.innerHTML = `${d.notSelling?.items ? `<p class="admin-note">${num(d.notSelling.items)} items in stock haven't sold (${keys(d.notSelling.valueKeys)}). Sort by "Not selling" to see them.</p>` : ''}
                ${table(['Item', 'Sold / week', 'Sold', 'Bought', 'Margin', 'Real margin', 'Profit / week', 'In stock'], (d.rows || []).map((r) => `<tr>
                    <td><button type="button" class="admin-bm-linkish" data-explain="${esc(r.bp_sku)}">${esc(r.bp_sku)}</button>${r.notSelling ? ' <span class="admin-tag tag-warn">not selling</span>' : ''}</td>
                    <td>${num(r2(r.soldPerWeek))}</td><td>${num(r.sold)}</td><td>${num(r.bought)}</td>
                    <td>${r.marginPct != null ? `${num(r2(r.marginPct))} %` : '–'}</td><td>${r.realizedMarginPct != null ? `${num(r2(r.realizedMarginPct))} %` : '–'}</td>
                    <td>${keys(r.profitPerWeekKeys)}</td><td>${num(r.inStock)}</td></tr>`), 'No item matches.')}
                ${d.total > (d.rows || []).length ? `<p class="muted">${num((d.rows || []).length)} of ${num(d.total)} shown.</p>` : ''}`
        }
        const draw_overrides = async () => {
            const res = await bm('admin:stock:settings')
            if(!box.isConnected){ return }
            const el = $('#bm-overrides')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const groups = res.data?.groupOverrides || [], items = res.data?.skuOverrides || []
            const what = (o) => [o.limit != null && `limit ${num(o.limit)}`, o.valueCapKeys != null && `cap ${keys(o.valueCapKeys)}`, o.perSkuMax != null && `${num(o.perSkuMax)} per item`, o.blocked && 'blocked'].filter(Boolean).join(', ')
            el.innerHTML = table(['Group or item', 'Set to', 'Note', ''], [
                ...groups.map((o) => `<tr><td>${group_name(o.key)}<span class="admin-help">${esc(o.key)}</span></td><td>${what(o) || '–'}</td><td>${esc(o.note || '')}</td>
                    <td class="admin-bm-cell-actions">${act('admin:stock:group:clear', { key: o.key }, 'Automatic', { ok: 'Automatic again.' })}</td></tr>`),
                ...items.map((o) => `<tr><td><button type="button" class="admin-bm-linkish" data-explain="${esc(o.bp_sku)}">${esc(o.bp_sku)}</button></td><td>${what(o) || '–'}</td><td>${esc(o.note || '')}</td>
                    <td class="admin-bm-cell-actions">${act('admin:stock:item:clear', { bp_sku: o.bp_sku }, 'Automatic', { ok: 'Automatic again.' })}</td></tr>`)
            ], 'Every limit is automatic.')
        }
        const refresh = () => { draw_status(); draw_groups(); draw_res(); draw_overrides() }

        box.addEventListener('submit', async (e) => {
            const form = e.target
            e.preventDefault()
            if(form.id == 'bm-groups-form'){
                query = { search: form.search.value.trim(), quality: form.quality.value, sort: form.sort.value, onlyStocked: form.onlyStocked.checked, onlyFull: form.onlyFull.checked, onlyOverridden: form.onlyOverridden.checked, page: 0 }
                return draw_groups()
            }
            if(form.id == 'bm-item-form'){ return explain(form.bp_sku.value.trim()) }
            if(form.id == 'bm-sellers-form'){ seller_query = { search: form.search.value.trim(), sort: form.sort.value }; return draw_sellers() }
            if(form.id == 'bm-sim-form'){
                const items = form.items.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
                    const m = l.match(/^(.*?)\s*[x×]\s*(\d+)$/i)
                    return m ? { bp_sku: m[1].trim(), n: Number(m[2]) } : { bp_sku: l, n: 1 }
                })
                const res = await busy(form.querySelector('button'), () => bm('admin:stock:simulate', { items }))
                const el = $('#bm-sim')
                if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
                const d = res.data || {}
                el.innerHTML = `<p class="${d.ok ? 'admin-bm-yes' : 'admin-error'}">${d.ok ? 'Yes, the bots would buy them.' : esc(d.message || 'No.')}</p>
                    ${(d.failures || []).length ? table(['Item', 'Why not', 'Limit', 'Have', 'Asked'], d.failures.map((f) => `<tr><td>${esc(f.bp_sku || f.group || '')}</td><td>${words(f.reason)}</td><td>${num(f.limit)}</td><td>${num(f.have)}</td><td>${num(f.need)}</td></tr>`)) : ''}
                    ${(d.items || []).filter((i) => !i.found).map((i) => `<p class="admin-error">Not found: ${esc(i.bp_sku)}</p>`).join('')}`
                return
            }
            if(form.dataset.override){
                const value = (name) => form[name].value.trim() === '' ? null : Number(form[name].value)
                const res = await busy(form.querySelector('[type="submit"]'), () => bm('admin:stock:group:override', { key: form.dataset.override, limit: value('limit'), valueCapKeys: value('valueCapKeys'), perSkuMax: value('perSkuMax'), blocked: form.blocked.checked, note: form.note.value.trim() }))
                if(toast(res, 'Saved. The limits are worked out again in a second.')){ refresh() }
                return
            }
            if(form.dataset.itemOverride){
                const raw = form.limit.value.trim()
                const res = await busy(form.querySelector('[type="submit"]'), () => raw === '' ? bm('admin:stock:item:clear', { bp_sku: form.dataset.itemOverride }) : bm('admin:stock:item:override', { bp_sku: form.dataset.itemOverride, limit: Number(raw) }))
                if(toast(res, 'Saved.')){ explain(form.dataset.itemOverride); draw_overrides() }
            }
        })
        box.addEventListener('click', (e) => {
            const page = e.target.closest('[data-page]')
            if(page){ query.page = Number(page.dataset.page); return draw_groups() }
            const ex = e.target.closest('[data-explain]')
            if(ex){ explain(ex.dataset.explain); $('#bm-item').closest('.admin-card').scrollIntoView({ block: 'nearest' }); return }
            const row = e.target.closest('.admin-bm-group-row')
            if(row && !e.target.closest('a, button')){ toggle_group(row) }
        })
        box.addEventListener('keydown', (e) => {
            const row = e.target.closest?.('.admin-bm-group-row')
            if(row && (e.key == 'Enter' || e.key == ' ') && e.target == row){ e.preventDefault(); toggle_group(row) }
        })
        actions(box, () => { refresh(); const item = $('#bm-item-form').bp_sku.value.trim(); if(item && $('#bm-item').innerHTML){ explain(item) } })

        await Promise.all([draw_status(), draw_groups(), draw_flow(), draw_res(), draw_sellers(), draw_overrides(), settings.load()])
        ctx.watch(['stock'], () => { draw_res(); draw_overrides(); settings.changed() })
        ctx.watch(['stock_updated'], (status) => { draw_status(status); draw_groups(); draw_flow() })
    }

    /* ========================= LISTINGS ========================= */

    const PRICE_KEYS = /^(priceWatchSec|priceFullCheckMin|priceWatchOfflineSec|verifyMin|relistAfterPatchFails|emergency(\..*)?)$/
    const price = (l) => {
        const c = l.currencies || {}
        const parts = [c.keys ? `${num(c.keys)} key${c.keys == 1 ? '' : 's'}` : '', c.metal ? ref(c.metal) : ''].filter(Boolean)
        return parts.length ? parts.join(', ') : l.price != null ? ref(l.price) : '–'
    }

    const tab_listings = async (box, ctx) => {
        box.innerHTML = `<div id="bm-lst-status">${loading}</div>
            <div class="admin-settings admin-bm-stack">
                <div class="admin-card wide">
                    <h3>Listings on backpack.tf</h3>
                    <form class="admin-bm-filters" id="bm-lst-form">
                        <label class="admin-field">Search <input type="search" name="search" placeholder="Item name" maxlength="100"></label>
                        <label class="admin-field">Kind <select name="intent"><option value="all">Sell and buy</option><option value="sell">Sell</option><option value="buy">Buy</option></select></label>
                        <label class="admin-field">Bot <select name="bot"><option value="">Every bot</option></select></label>
                        <button type="submit" class="primary">Show</button>
                    </form>
                    <div id="bm-lst">${loading}</div>
                </div>
                <div class="admin-card">
                    <h3>Always or never list</h3>
                    <p class="muted">Always: listed whenever it can be. Never: not listed, also not by hand above.</p>
                    <form id="bm-pin-form">
                        <input type="text" name="bp_sku" placeholder="Item name, e.g. Team Captain" required maxlength="200" aria-label="Item name">
                        <div class="admin-bm-actions">
                            <select name="intent" aria-label="Sell or buy"><option value="sell">Selling</option><option value="buy">Buying</option></select>
                            <button type="submit" name="what" value="pin">Always list</button>
                            <button type="submit" name="what" value="block">Never list</button>
                        </div>
                    </form>
                    <div id="bm-pins">${loading}</div>
                </div>
                <div class="admin-card">
                    <h3>Why items aren't listed</h3>
                    <div id="bm-why">${loading}</div>
                    <form class="admin-inline-form" id="bm-unlisted-form"><input type="search" name="search" placeholder="Item name or type" maxlength="100"><button type="submit">Find bot items without a price</button></form>
                    <div id="bm-unlisted"></div>
                </div>
            </div>
            <div class="admin-settings admin-bm-stack" id="bm-lst-settings"></div>`
        const $ = (sel) => box.querySelector(sel)
        const settings = settings_card($('#bm-lst-settings'), {
            title: 'Listing settings', help: HELP.listings, ...scope_settings('listings', (d) => ({
                config: d.config, defaults: d.defaults,
                placeholders: Object.fromEntries(Object.entries(d.texts?.defaults || {}).map(([k, v]) => [`text.${k}`, v]))
            })),
            intro: 'Used at the next sync, which starts right after saving. Price checks and emergency pricing are on the Prices tab.',
            only: (path) => !PRICE_KEYS.test(path), open: ['text']
        })

        let bots = []
        const draw_status = async () => {
            const [res, set] = await Promise.all([bm('admin:listings:status'), bm('admin:listings:settings')])
            if(!box.isConnected){ return }
            if(res.status != 'ok'){ return failed(box, res) }
            const s = res.data || {}, plan = s.sellPlan || {}, bp = s.buyPlan || {}
            bots = s.bots || []
            const paused = set.status == 'ok' ? set.data.paused : s.paused
            $('#bm-lst-status').innerHTML = `<div class="admin-bm-toolbar">
                    <span>${paused ? pill(false, '', 'Paused') : s.syncing ? pill(true, 'Syncing') : pill(s.started, 'Running', 'Not started')}</span>
                    <span class="admin-bm-actions">
                        ${act('admin:listings:sync', {}, 'Sync now', { cls: 'primary', ok: 'Sync done.' })}
                        ${act('admin:listings:verify', {}, 'Check prices on backpack.tf', { ok: 'Checked. Listings at an old price are listed again.' })}
                        ${act('admin:listings:rematch', {}, 'Match unpriced items', { ok: 'Bot items without a price checked again.' })}
                        ${paused ? act('admin:listings:pause', { paused: false }, 'Resume', { ok: 'Listings run again.' }) : act('admin:listings:pause', { paused: true }, 'Pause', { confirm: 'Freeze the listings? Prices still update.', ok: 'Listings paused.' })}
                        ${act('admin:listings:clear', {}, 'Remove all', { cls: 'danger', confirm: 'Remove EVERY listing of every bot from backpack.tf and pause listings?', ok: 'All listings removed, listings paused.' })}
                    </span>
                </div>
                <div class="admin-stats">
                    ${stat('Sell listings', num(s.totals?.sell), plan.variants != null ? `${num(plan.variants)} items in stock` : '')}
                    ${stat('Buy listings', num(s.totals?.buy), bp.candidates != null ? `${num(bp.candidates)} buy candidates` : '')}
                    ${stat('Last sync', ago_stat(s.lastSync), s.nextSync ? `next ${later(s.nextSync)}` : '')}
                    ${stat('Old text', num(s.textOutdated || 0), 'listings to recreate')}
                    ${stat('Price check', ago_stat(s.priceCheck?.lastFull), s.priceCheck?.last ? `${num(s.priceCheck.last.drift)} relisted, ${num(s.priceCheck.last.missing)} made again` : '')}
                </div>
                <div class="admin-card admin-bm-slots">
                    <h3>Slots per bot</h3>
                    ${table(['Bot', 'Sell', 'Buy', 'Slots', 'Pure', 'Buy listings worth'], bots.map((b) => `<tr>
                        <td>${esc(b.name || b.steamid)}${b.paused ? ' <span class="admin-tag tag-warn">paused</span>' : ''}${b.listing === false ? ' <span class="admin-tag">not listing</span>' : ''}</td>
                        <td>${num(b.sell)}</td><td>${num(b.buy)}</td>
                        <td><span class="admin-bm-meter" style="--fill:${Math.min(100, Math.round(((b.sell || 0) + (b.buy || 0)) / Math.max(1, b.slots || 1) * 100))}%"></span>${num((b.sell || 0) + (b.buy || 0))} / ${num(b.slots)}</td>
                        <td>${ref(b.pure)}</td><td>${ref(b.buyValue)}${b.biggestBuy ? ` <span class="muted">biggest ${ref(b.biggestBuy)}</span>` : ''}</td></tr>`), 'No bot lists.')}
                </div>`
            const select = $('#bm-lst-form').bot
            const picked = select.value
            select.innerHTML = '<option value="">Every bot</option>' + bots.map((b) => `<option value="${esc(b.steamid)}">${esc(b.name || b.steamid)}</option>`).join('')
            select.value = picked

            $('#bm-why').innerHTML = `<h4 class="admin-bm-sub">Items in stock without a sell listing</h4>${counts(plan.skipped, 'Every item in stock is listed.')}
                ${s.recentItems?.total ? `<h4 class="admin-bm-sub">Received in the last 24 h</h4><p class="muted">${num(s.recentItems.listed)} of ${num(s.recentItems.total)} listed.</p>${counts(s.recentItems.byWhy, '')}` : ''}
                ${bp.skipped ? `<h4 class="admin-bm-sub">Buy candidates not listed</h4>${counts(bp.skipped, 'None.')}` : ''}`
            if(set.status == 'ok'){
                const pins = (list, intent, what) => (list || []).map((sku) => `<span class="admin-chip">${esc(sku)} ${act(`admin:listings:${what}`, { intent, bp_sku: sku, on: false }, '×', { ok: 'Removed.' }).replace('<button', '<button aria-label="Remove" title="Remove"')}</span>`).join('')
                const p = set.data.pinned || {}, b = set.data.blocked || {}
                $('#bm-pins').innerHTML = [['Always sell', pins(p.sell, 'sell', 'pin')], ['Always buy', pins(p.buy, 'buy', 'pin')], ['Never sell', pins(b.sell, 'sell', 'block')], ['Never buy', pins(b.buy, 'buy', 'block')]]
                    .map(([label, chips]) => `<h4 class="admin-bm-sub">${label}</h4>${chips ? `<div class="admin-chips">${chips}</div>` : '<p class="admin-empty">None.</p>'}`).join('')
            } else {
                $('#bm-pins').innerHTML = error_line(set)
            }
        }

        let query = { intent: 'all', offset: 0 }
        const draw_list = async () => {
            const res = await bm('admin:listings:page', { ...query, limit: 25 })
            if(!box.isConnected){ return }
            const el = $('#bm-lst')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const d = res.data || {}
            if(d.empty){ el.innerHTML = `<p class="admin-empty">No listings: ${words(d.empty)}.</p>`; return }
            const from = d.offset || 0, to = from + (d.items || []).length
            el.innerHTML = table(['Item', 'Kind', 'Bot', 'Price', 'Updated', ''], (d.items || []).map((l) => `<tr>
                    <td><a href="https://backpack.tf/classifieds?item=${encodeURIComponent(l.bp_sku || '')}" target="_blank" rel="noopener nofollow">${esc(l.bp_sku)}</a>${l.pinned ? ' <span class="admin-tag">always</span>' : ''}</td>
                    <td><span class="admin-tag ${l.intent == 'buy' ? 'tag-buy' : 'tag-sell'}">${l.intent == 'buy' ? 'Buy' : 'Sell'}</span></td>
                    <td>${esc(l.botName || l.bot || '–')}</td><td>${price(l)}</td><td>${ago(l.updated || l.created)}</td>
                    <td class="admin-bm-cell-actions">${act('admin:listings:remove', { id: l.id }, 'Remove', { ok: 'Listing removed. It comes back at the next sync unless you pick Never.' })}
                        ${act('admin:listings:remove', { id: l.id, block: true }, 'Never', { confirm: `Remove this listing and never ${l.intent == 'buy' ? 'buy' : 'sell'} ${l.bp_sku} on backpack.tf again?`, ok: 'Removed, and never listed again.' })}</td></tr>`), 'No listing matches.') +
                `<div class="admin-pager"><button type="button" data-offset="${Math.max(0, from - 25)}" ${from <= 0 ? 'disabled' : ''}>Previous</button>
                    <span class="muted">${num(from + (to > from ? 1 : 0))}–${num(to)} of ${num(d.total)}</span>
                    <button type="button" data-offset="${to}" ${to >= (d.total || 0) ? 'disabled' : ''}>Next</button></div>`
        }

        box.addEventListener('submit', async (e) => {
            const form = e.target
            e.preventDefault()
            if(form.id == 'bm-lst-form'){ query = { search: form.search.value.trim(), intent: form.intent.value, bot: form.bot.value || undefined, offset: 0 }; return draw_list() }
            if(form.id == 'bm-pin-form'){
                const what = e.submitter?.value == 'block' ? 'block' : 'pin'
                const res = await busy(e.submitter || form.querySelector('button'), () => bm(`admin:listings:${what}`, { intent: form.intent.value, bp_sku: form.bp_sku.value.trim(), on: true }))
                if(toast(res, what == 'pin' ? 'Always listed from the next sync.' : 'Never listed; a listing of it comes down at the next sync.')){ form.bp_sku.value = ''; draw_status() }
                return
            }
            if(form.id == 'bm-unlisted-form'){
                const el = $('#bm-unlisted')
                el.innerHTML = loading
                const res = await bm('admin:listings:unlisted', { search: form.search.value.trim(), limit: 100 })
                if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
                const u = res.data?.unmatched || {}
                el.innerHTML = `<p class="muted">${num(u.copies)} copies of ${num(u.items)} items on the bots match no priced item in the database, so they aren't in stock.</p>
                    ${counts(u.byReason, '')}
                    ${table(['Bot item', 'Copies', 'Why'], (u.rows || []).map((r) => `<tr><td>${esc(r.bp_sku)}<span class="admin-help">${esc(QUALITY_NAMES[r.qualityID] || '')} ${esc(r.type || '')}</span></td><td>${num(r.count)}</td>
                        <td>${words(r.why)}${r.similar?.length ? `<span class="admin-help">Close: ${r.similar.slice(0, 3).map((x) => esc(x.bp_sku)).join(', ')}</span>` : ''}${r.dbQualities?.length ? `<span class="admin-help">Database has: ${r.dbQualities.map((q) => esc(QUALITY_NAMES[q] || q)).join(', ')}</span>` : ''}</td></tr>`), 'Every bot item has a price.')}`
            }
        })
        box.addEventListener('click', (e) => {
            const off = e.target.closest('[data-offset]')
            if(off){ query.offset = Number(off.dataset.offset); draw_list() }
        })
        actions(box, () => { draw_status(); draw_list() })

        await Promise.all([draw_status(), draw_list(), settings.load()])
        ctx.watch(['listings'], () => { draw_status(); draw_list(); settings.changed() })
        ctx.every(30000, draw_status)
    }

    /* ========================= PRICES (+ set by hand, what we paid) ========================= */

    // a price in ref as [keys, ref] at the key price it was saved with
    const in_keys = (metal, key) => {
        const m = Number(metal) || 0, k = Number(key) || 0
        const whole = k > 0 ? Math.floor((m + 0.005) / k) : 0
        return [whole, r2(m - whole * k)]
    }
    const keys_ref = (k, r) => [k ? `${num(k)} key${k == 1 ? '' : 's'}` : '', r || !k ? ref(r) : ''].filter(Boolean).join(', ')
    const price_text = (metal, key) => keys_ref(...in_keys(metal, key))
    const pair_input = (name, label, keep) => `<div class="admin-field">${label}
        <span class="admin-bm-pair">
            <span class="admin-input-unit"><input type="number" name="${name}_keys" min="0" step="1" inputmode="numeric"${keep ? ' placeholder="keep"' : ''} aria-label="${label}, keys"><em>keys</em></span>
            <span class="admin-input-unit"><input type="number" name="${name}_ref" min="0" step="0.01" inputmode="decimal"${keep ? ' placeholder="keep"' : ''} aria-label="${label}, ref"><em>ref</em></span>
        </span></div>`

    // Prices set by hand (service/manual_prices.js): straight in the database, so this works without bot_manager too
    const manual_card = (box, ctx) => {
        const card = box.querySelector('#bm-manual')
        card.innerHTML = `<h3>Prices set by hand</h3>
            <p class="muted">Sell an item for your own price. Locked, the price only changes here and item_manager leaves it alone. Not locked, item_manager prices the item again at its next round. The price is in ref at today's key price, like item_manager's; killstreak versions keep their own prices.</p>
            <form class="admin-bm-manual-form" id="bm-manual-form" autocomplete="off">
                <label class="admin-field">Item <input type="search" name="bp_sku" list="bm-manual-names" required maxlength="200" placeholder="Item name, e.g. Team Captain" spellcheck="false"></label>
                <datalist id="bm-manual-names"></datalist>
                ${pair_input('sell', 'Sell for')}
                ${pair_input('buy', 'Buy for', true)}
                <div class="admin-bm-checks">
                    <label class="check"><input type="checkbox" name="locked" checked> Lock the price</label>
                    <label class="check"><input type="checkbox" name="list" checked> Always list it for sale</label>
                </div>
                <button type="submit" class="primary">Save price</button>
            </form>
            <p class="admin-help admin-bm-now" id="bm-manual-now" aria-live="polite"></p>
            <div id="bm-manual-list">${loading}</div>`
        const form = card.querySelector('#bm-manual-form')
        const found = new Map()
        let pinned = null

        const describe = (i) => {
            const m = i.manual
            const parts = [`Now sells for ${price_text(i.sell, i.key_price)} and buys for ${price_text(i.buy, i.key_price)}`, `${num(i.stock)} in stock`]
            if(i.status != 1){ parts.push('not priced by item_manager') }
            if(m){ parts.push(m.locked ? `locked by hand ${ago(m.at)}` : `set by hand ${ago(m.at)}, not locked`) }
            return parts.join(', ') + '.'
        }
        const fill = (i) => {
            const m = i.manual
            const [sk, sr] = m ? [m.keys, m.ref] : in_keys(i.sell, i.key_price)
            form.sell_keys.value = sk || ''
            form.sell_ref.value = sr || ''
            form.buy_keys.value = m?.buy_keys ?? ''
            form.buy_ref.value = m?.buy_ref ?? ''
            form.locked.checked = m ? m.locked !== false : true
            card.querySelector('#bm-manual-now').textContent = describe(i).replace(/<[^>]+>/g, '')
        }

        let timer = null
        form.bp_sku.addEventListener('input', () => {
            clearTimeout(timer)
            const q = form.bp_sku.value.trim()
            if(found.has(q)){ return fill(found.get(q)) }
            card.querySelector('#bm-manual-now').textContent = ''
            timer = setTimeout(async () => {
                const res = await kit.api(`/api/admin/manual_prices/search?q=${encodeURIComponent(q)}`)
                if(res.status != 'ok' || form.bp_sku.value.trim() != q){ return }
                for (const i of res.items || []) { found.set(i.bp_sku, i) }
                card.querySelector('#bm-manual-names').innerHTML = (res.items || []).map((i) => `<option value="${esc(i.bp_sku)}"></option>`).join('')
                if(found.has(q)){ fill(found.get(q)) }
            }, 250)
        })

        const draw = async () => {
            const [res, set] = await Promise.all([kit.api('/api/admin/manual_prices'), bm('admin:listings:settings')])
            if(!card.isConnected){ return }
            const el = card.querySelector('#bm-manual-list')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            pinned = set.status == 'ok' ? new Set(set.data?.pinned?.sell || []) : null
            for (const i of res.items || []) { found.set(i.bp_sku, i) }
            el.innerHTML = table(['Item', 'Sells for', 'Buys for', 'In stock', 'Set', ''], (res.items || []).map((i) => {
                const m = i.manual
                const own = Math.abs((Number(m.sell) || 0) - i.sell) < 0.01
                return `<tr>
                    <td>${esc(i.bp_sku)}
                        ${m.locked ? '<span class="admin-tag tag-warn">locked</span>' : '<span class="admin-tag">not locked</span>'}
                        ${pinned?.has(i.bp_sku) ? '<span class="admin-tag tag-sell">always listed</span>' : ''}</td>
                    <td>${own ? keys_ref(m.keys, m.ref) : `${price_text(i.sell, i.key_price)}<span class="admin-help">item_manager's price; yours was ${keys_ref(m.keys, m.ref)}</span>`}</td>
                    <td>${price_text(i.buy, i.key_price)}</td>
                    <td>${num(i.stock)}</td>
                    <td>${ago(m.at)}<span class="admin-help">${/^\d{17}$/.test(m.by || '') ? profile(m.by, `…${m.by.slice(-5)}`) : esc(m.by || '')}</span></td>
                    <td class="admin-bm-cell-actions">
                        <button type="button" data-manual-edit="${esc(i.bp_sku)}">Edit</button>
                        <button type="button" data-manual-lock="${esc(i.bp_sku)}" data-locked="${m.locked ? '0' : '1'}">${m.locked ? 'Unlock' : 'Lock'}</button>
                        ${pinned && !pinned.has(i.bp_sku) ? act('admin:listings:pin', { intent: 'sell', bp_sku: i.bp_sku, on: true }, 'Always list', { ok: 'Always listed from the next sync, which starts now.' }) : ''}
                        <button type="button" data-manual-forget="${esc(i.bp_sku)}">Forget</button></td></tr>`
            }), 'No price is set by hand.')
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault()
            const btn = form.querySelector('[type="submit"]')
            const payload = {
                bp_sku: form.bp_sku.value.trim(), locked: form.locked.checked, list: form.list.checked,
                sell: { keys: form.sell_keys.value, ref: form.sell_ref.value },
                buy: (form.buy_keys.value !== '' || form.buy_ref.value !== '') ? { keys: form.buy_keys.value, ref: form.buy_ref.value } : null
            }
            const res = await busy(btn, () => kit.api('/api/admin/manual_prices', payload))
            if(toast(res, `${esc(payload.bp_sku)} now sells for ${price_text(res.item?.sell, res.item?.key_price)}${payload.locked ? ', locked' : ''}.${(res.notes || []).map((n) => ` ${esc(n)}`).join('')}`)){
                found.set(res.item.bp_sku, res.item)
                fill(res.item)
                draw()
            }
        })
        card.addEventListener('click', async (e) => {
            const edit = e.target.closest('[data-manual-edit]')
            if(edit){
                const i = found.get(edit.dataset.manualEdit)
                form.bp_sku.value = edit.dataset.manualEdit
                if(i){ fill(i) }
                form.scrollIntoView({ block: 'center' })
                form.sell_keys.focus()
            }
            const lock = e.target.closest('[data-manual-lock]')
            if(lock){
                const on = lock.dataset.locked == '1'
                if(!on && !confirm(`Unlock ${lock.dataset.manualLock}? item_manager prices it again at its next round.`)){ return }
                const res = await busy(lock, () => kit.api('/api/admin/manual_prices/lock', { bp_sku: lock.dataset.manualLock, locked: on }))
                if(toast(res, on ? 'Locked: only changed here.' : 'Unlocked: item_manager prices it again.')){ draw() }
            }
            const forget = e.target.closest('[data-manual-forget]')
            if(forget){
                if(!confirm(`Forget the price you set for ${forget.dataset.manualForget}? It stays until item_manager prices the item again.`)){ return }
                const res = await busy(forget, () => kit.api('/api/admin/manual_prices/forget', { bp_sku: forget.dataset.manualForget }))
                if(toast(res, 'Forgotten.')){ draw() }
            }
        })
        actions(card, draw)
        ctx.watch(['listings'], draw)
        ctx.every(30000, () => { if(!card.querySelector('form :focus')){ draw() } })
        return draw()
    }

    const tab_prices = async (box, ctx) => {
        box.innerHTML = `<div id="bm-price-status">${loading}</div>
            <div class="admin-settings admin-bm-stack">
                <div class="admin-card wide" id="bm-manual"></div>
                <div class="admin-card wide"><h3>Emergency prices</h3><p class="muted">Prices bot_manager set from backpack.tf while item_manager was down.</p><div id="bm-emergency">${loading}</div></div>
                <div class="admin-card wide">
                    <h3>What we paid</h3>
                    <p class="muted">After a price drop, a copy isn't sold under what we paid right away: first held, then at what we paid, then with a small loss, then at the market price.</p>
                    <div id="bm-holds">${loading}</div>
                    <form class="admin-inline-form" id="bm-backfill">
                        <span class="admin-input-unit"><input type="number" name="days" min="1" max="365" placeholder="21" aria-label="Days of saved trades"><em>days</em></span>
                        <button type="submit" name="apply" value="0">Count copies without a price</button>
                        <button type="submit" name="apply" value="1">Fill them in from saved trades</button>
                    </form>
                </div>
            </div>
            <div class="admin-settings admin-bm-stack" id="bm-price-settings"></div>`
        const $ = (sel) => box.querySelector(sel)
        const listing_settings = scope_settings('listings')
        const checks = settings_card($('#bm-price-settings'), {
            title: 'Price checks', help: HELP.listings, ...listing_settings, reset: null,
            intro: 'How often bot_manager reads the database prices and compares its listings with backpack.tf, and when it prices items itself. Part of the listing settings (Reset is on the Listings tab).',
            only: (path) => PRICE_KEYS.test(path), open: ['emergency']
        })
        const holds = settings_card($('#bm-price-settings'), { title: 'What we paid: settings', help: HELP.holds, ...scope_settings('holds') })

        const draw_status = async () => {
            const res = await bm('admin:prices:status')
            if(!box.isConnected){ return }
            // prices set by hand work without bot_manager: only this part says it's offline
            if(res.status != 'ok'){ $('#bm-emergency').innerHTML = ''; return failed($('#bm-price-status'), res) }
            const w = res.data?.priceWatch || {}, c = res.data?.priceCheck || {}, e = res.data?.emergency || {}, im = w.itemManager || e.itemManager || {}
            $('#bm-price-status').innerHTML = `<div class="admin-bm-toolbar">
                    <span>${pill(im.connected, 'item_manager connected', 'item_manager not connected')} ${e.mode == 'active' ? '<span class="admin-tag tag-warn">emergency pricing on</span>' : ''}</span>
                    <span class="admin-bm-actions">
                        ${act('admin:prices:check_db', {}, 'Read database prices now', { ok: 'Database prices read.' })}
                        <button type="button" data-emergency>Emergency pricing now…</button>
                    </span>
                </div>
                <div class="admin-stats">
                    ${stat('item_manager', im.connected ? 'Up' : 'Down', im.lastPush ? `last price ${ago(im.lastPush)}` : im.since ? `since ${ago(im.since)}` : '')}
                    ${stat('Database check', ago_stat(w.lastCheck), `every ${num(w.everySec)} s, all ${ago(w.lastFullCheck)}`)}
                    ${stat('backpack.tf check', ago_stat(c.lastFull), c.last ? `${num(c.last.drift)} relisted, ${num(c.last.missing)} made again` : c.running ? 'running' : '')}
                    ${stat('Emergency pricing', words(e.mode || 'off'), e.reason ? words(e.reason) : e.waiting != null ? `${num(e.waiting)} items waiting` : '')}
                    ${stat('Relists waiting', num(c.relistQueued), c.patchFailing ? `${num(c.patchFailing)} price updates failing` : '')}
                </div>
                ${e.rateLimitedUntil ? `<p class="admin-note">backpack.tf rate limit until ${when(e.rateLimitedUntil)}.</p>` : ''}
                ${(w.lastChanges || []).length ? `<details class="admin-howto"><summary>Last price changes from the database (${num(w.lastChanges.length)})</summary>
                    <div class="admin-chips">${w.lastChanges.slice(0, 40).map((x) => `<span class="admin-tag">${esc(typeof x == 'string' ? x : x.bp_sku || x.name || JSON.stringify(x))}</span>`).join('')}</div></details>` : ''}`
            $('#bm-emergency').innerHTML = `${e.lastRun ? `<p class="muted">Last run ${ago(e.lastRun.at || e.lastRun.finished)}: ${num(e.lastRun.priced?.length ?? e.lastRun.priced)} priced, ${num(e.lastRun.unchanged)} unchanged, ${num(e.lastRun.skipped?.length ?? e.lastRun.skipped)} skipped.</p>` : ''}
                ${table(['When', 'Item', 'Sell', 'Buy', 'item_manager had'], (e.history || []).slice(0, 30).map((h) => `<tr><td>${ago(h.at)}</td><td>${esc(h.name || h.bp_sku)}</td>
                    <td>${h.sell != null ? ref(h.sell) : '–'}</td><td>${h.buy != null ? ref(h.buy) : '–'}</td><td>${h.last?.sell != null ? ref(h.last.sell) : h.last != null && typeof h.last != 'object' ? ref(h.last) : '–'}</td></tr>`), 'bot_manager hasn\'t had to price anything itself.')}`
        }

        const draw_holds = async () => {
            const res = await bm('admin:holds:status', { limit: 100 })
            if(!box.isConnected){ return }
            const el = $('#bm-holds')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            const d = res.data || {}
            el.innerHTML = `${facts([
                    ['Copies with a paid price', num(d.records)],
                    ['Paid for them', ref(d.paidTotal)],
                    d.waitingForReceipt && ['Waiting for a trade receipt', num(d.waitingForReceipt)],
                    d.lastReview && ['Last review', ago(d.lastReview.started || d.lastReview.at)]
                ])}
                ${counts(d.byPhase, '')}
                ${table(['Item', 'Bot', 'Paid', 'Market', 'Asking', 'Now', ''], (d.items || []).map((i) => `<tr>
                    <td>${esc(i.name || i.bp_sku)}<span class="admin-help">${esc(i.assetid)}${i.bought ? `, bought ${ago(i.bought)}` : ''}</span></td>
                    <td>${esc(i.botName || i.bot || '–')}</td><td>${ref(i.paid)}<span class="admin-help">${words(i.source)}</span></td><td>${i.market != null ? ref(i.market) : '–'}</td><td>${i.asks != null ? ref(i.asks) : '–'}</td>
                    <td>${words(i.phase)}${i.underSince ? `<span class="admin-help">under since ${ago(i.underSince)}</span>` : ''}</td>
                    <td class="admin-bm-cell-actions"><button type="button" data-paid="${esc(i.assetid)}" data-value="${esc(i.paid)}">Paid…</button>
                        ${act('admin:holds:release', { assetid: i.assetid }, 'Forget', { confirm: 'Forget what we paid for this copy? It sells at the market price.', ok: 'Forgotten.' })}</td></tr>`), 'No copy has a paid price yet.')}`
        }

        box.addEventListener('click', async (e) => {
            const paid = e.target.closest('[data-paid]')
            if(paid){
                const value = prompt('What we paid for this copy, in ref at today\'s key price:', paid.dataset.value)
                if(value === null){ return }
                if(!(Number(value) >= 0) || value.trim() === ''){ return iziToast.error({ title: 'Error', message: 'Enter a price in ref.' }) }
                const res = await busy(paid, () => bm('admin:holds:set', { assetid: paid.dataset.paid, paid: Number(value) }))
                if(toast(res, 'Saved.')){ draw_holds() }
            }
            const emergency = e.target.closest('[data-emergency]')
            if(emergency){
                const names = prompt('Price these items from backpack.tf now (names, separated by commas). Leave empty for every item with an old price, even while item_manager is up.', '')
                if(names === null){ return }
                const skus = names.split(',').map((n) => n.trim()).filter(Boolean)
                const res = await busy(emergency, () => bm('admin:prices:emergency:run', skus.length ? { skus } : { force: true }))
                const out = res.data || {}
                if(toast(res, `Done: ${num(out.priced?.length ?? out.priced ?? 0)} priced.`)){ draw_status() }
            }
        })
        $('#bm-backfill').addEventListener('submit', async (e) => {
            e.preventDefault()
            const apply = e.submitter?.value == '1'
            if(apply && !confirm('Give every copy without a paid price the buy price of the same item in recent saved trades (an estimate)?')){ return }
            const days = Number(e.target.days.value) || undefined
            const res = await busy(e.submitter, () => bm('admin:holds:backfill', { apply, ...(days ? { days } : {}) }))
            const d = res.data || {}
            if(toast(res, apply ? `Filled in ${num(d.applied ?? d.set ?? d.matched ?? 0)} copies.` : `${num(d.missing ?? d.candidates ?? d.matched ?? 0)} copies have no paid price, ${num(d.matched ?? 0)} of them can be filled in.`)){ draw_holds() }
        })
        actions(box, () => { draw_status(); draw_holds() })

        await Promise.all([manual_card(box, ctx), draw_status(), draw_holds(), checks.load(), holds.load()])
        ctx.watch(['prices', 'listings', 'system'], () => { draw_status(); checks.changed() })
        ctx.watch(['holds'], () => { draw_holds(); holds.changed() })
        ctx.every(30000, draw_status)
    }

    /* ========================= BUY ORDERS ========================= */

    const offer_rows = (list) => list.map((o) => `<tr>
        <td>${o.at ? ago(o.at) : '–'}</td><td>${o.kind == 'key_sale' ? '<span class="admin-tag">key sale</span>' : esc(o.name || o.bp_sku || '–')}</td>
        <td>${profile(o.steamid)}</td><td>${o.price != null ? (typeof o.price == 'object' ? esc(Object.entries(o.price).map(([k, v]) => `${v} ${k}`).join(', ')) : ref(o.price)) : '–'}${o.ask != null ? `<span class="admin-help">we ask ${typeof o.ask == 'object' ? esc(JSON.stringify(o.ask)) : ref(o.ask)}</span>` : ''}</td>
        <td>${words(o.state)}${o.reason ? `<span class="admin-help">${words(o.reason)}</span>` : ''}</td>
        <td>${o.offerID ? `<a href="https://steamcommunity.com/tradeoffer/${esc(o.offerID)}/" target="_blank" rel="noopener nofollow">${esc(o.offerID)}</a>` : '–'}</td></tr>`)

    const tab_buyorders = async (box, ctx) => {
        box.innerHTML = `<div id="bm-bo-status">${loading}</div>
            <div class="admin-settings admin-bm-stack">
                <div class="admin-card"><h3>Last check</h3><div id="bm-bo-scan">${loading}</div></div>
                <div class="admin-card"><h3>Key sales</h3><p class="muted">Short of metal: spare keys go to backpack.tf key buy orders for the metal we lack most.</p><div id="bm-bo-keys">${loading}</div></div>
                <div class="admin-card wide"><h3>Offers</h3>
                    <form class="admin-inline-form" id="bm-bo-history">
                        <input type="search" name="steamid" placeholder="Buyer SteamID64" inputmode="numeric" maxlength="17">
                        <select name="state" aria-label="State"><option value="">Every state</option>${['sent', 'accepted', 'declined', 'canceled', 'failed', 'expired'].map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
                        <button type="submit">Show saved offers</button>
                    </form>
                    <div id="bm-bo-offers">${loading}</div></div>
            </div>
            <div class="admin-settings admin-bm-stack" id="bm-bo-settings"></div>`
        const $ = (sel) => box.querySelector(sel)
        const settings = settings_card($('#bm-bo-settings'), { title: 'Buy order settings', help: HELP.buyorders, ...scope_settings('buyorders') })

        const draw = async () => {
            const res = await bm('admin:buyorders:status', { limit: 50 })
            if(!box.isConnected){ return }
            if(res.status != 'ok'){ return failed(box, res) }
            const d = res.data || {}, ws = d.websocket || {}, ks = d.keySale || {}, scan = d.lastScan || {}, live = d.live || {}
            $('#bm-bo-status').innerHTML = `<div class="admin-bm-toolbar">
                    <span>${pill(d.enabled, 'On', 'Off')} ${ws.enabled ? pill(ws.connected, 'Live feed connected', 'Live feed down') : '<span class="admin-tag">live feed off</span>'}</span>
                    <span class="admin-bm-actions">
                        <button type="button" data-scan>Check buy orders now…</button>
                        ${act('admin:buyorders:keysale', { force: true }, 'Key sale check now', { ok: 'Key sale checked.' })}
                        <button type="button" data-forget>Let a buyer get offers again…</button>
                    </span>
                </div>
                <div class="admin-stats">
                    ${stat('Open offers', num(d.open?.length), `${num(d.queued?.length)} queued`)}
                    ${stat('Last hour', num(d.offersLastHour), 'offers sent')}
                    ${stat('Accepted', num(d.finished?.accepted), `${num(d.finished?.declined)} declined, ${num(d.finished?.canceled)} cancelled`)}
                    ${stat('Live feed', num(ws.events), ws.lastEvent ? `events, last ${ago(ws.lastEvent)}` : 'events')}
                    ${stat('Trade links', num(ws.tradeLinks), 'remembered')}
                </div>
                ${ws.error ? `<p class="admin-error">Live feed: ${esc(ws.error)}</p>` : ''}
                ${d.rateLimitedUntil ? `<p class="admin-note">backpack.tf rate limit until ${when(d.rateLimitedUntil)}.</p>` : ''}`
            const out = (o, label) => o?.at ? `<h4 class="admin-bm-sub">${label}, ${ago(o.at)}</h4>${facts([['Items checked', num(o.checked)], ['Buy orders', num(o.buyOrders)], ['Paying our price', num(o.matched)], ['Offers queued', num(o.queued?.length ?? o.queued)]])}
                ${counts(o.skipped, '')}${Object.keys(o.samples || {}).length ? `<details class="admin-howto"><summary>Examples</summary>${Object.entries(o.samples).map(([k, list]) => `<p class="admin-help"><b>${words(k)}:</b> ${list.map(esc).join(', ')}</p>`).join('')}</details>` : ''}` : ''
            $('#bm-bo-scan').innerHTML = (out(scan, 'Scheduled check') + out(live, 'Live feed since start')) || '<p class="admin-empty">No check yet.</p>'
            const m = ks.metal || {}
            $('#bm-bo-keys').innerHTML = `${pill(ks.enabled, 'On', 'Off')}
                ${facts([
                    ['Metal', ['ref', 'rec', 'scrap'].map((t) => `${num(m.have?.[t])} / ${num(m.target?.[t])} ${t}`).join(', ')],
                    ['Short of', m.short?.length ? m.short.map(esc).join(', ') : 'nothing'],
                    ['Keys', m.keys ? `${num(m.keys.free)} free, keep ${num(m.keys.keep)}, ${num(m.keys.spare)} spare` : '–'],
                    ['Sales today', num(ks.offersToday)],
                    ks.last && ['Last check', `${ago(ks.last.at)}: ${words(ks.last.result)}`]
                ])}`
            $('#bm-bo-offers').innerHTML = table(['When', 'Item', 'Buyer', 'Their price', 'State', 'Offer'], offer_rows([...(d.open || []), ...(d.recent || [])].filter((o, i, all) => all.findIndex((x) => (x.offerID && x.offerID == o.offerID) || x === o) == i)), 'No offers yet.')
        }

        box.addEventListener('submit', async (e) => {
            if(e.target.id != 'bm-bo-history'){ return }
            e.preventDefault()
            const form = e.target
            const res = await bm('admin:buyorders:history', { limit: 100, ...(form.steamid.value.trim() ? { steamid: form.steamid.value.trim() } : {}), ...(form.state.value ? { state: form.state.value } : {}) })
            $('#bm-bo-offers').innerHTML = res.status != 'ok' ? error_line(res) : table(['When', 'Item', 'Buyer', 'Their price', 'State', 'Offer'], offer_rows((res.data || []).map((o) => ({ ...o, at: o.at || o.created || o.time }))), 'No saved offers match.')
        })
        box.addEventListener('click', async (e) => {
            const scan = e.target.closest('[data-scan]')
            if(scan){
                const names = prompt('Check the buy orders of these items (names, separated by commas). Empty = the next items in turn.', '')
                if(names === null){ return }
                const list = names.split(',').map((n) => n.trim()).filter(Boolean)
                const res = await busy(scan, () => bm('admin:buyorders:scan', list.length ? { names: list } : {}))
                if(toast(res, 'Checked.')){ draw() }
            }
            const forget = e.target.closest('[data-forget]')
            if(forget){
                const steamid = prompt('SteamID64 of the buyer who may get offers again. Empty = everyone.', '')
                if(steamid === null){ return }
                if(steamid.trim() && !/^\d{17}$/.test(steamid.trim())){ return iziToast.error({ title: 'Error', message: 'That is not a SteamID64 (17 digits).' }) }
                const res = await busy(forget, () => bm('admin:buyorders:forget', steamid.trim() ? { steamid: steamid.trim() } : {}))
                if(toast(res, 'They can get offers again.')){ draw() }
            }
        })
        actions(box, draw)

        await Promise.all([draw(), settings.load()])
        ctx.watch(['buyorders'], () => { draw(); settings.changed() })
        ctx.every(30000, draw)
    }

    /* ========================= BALANCE ========================= */

    const PURE = ['keys', 'ref', 'rec', 'scrap']
    const tab_balance = async (box, ctx) => {
        box.innerHTML = `<div id="bm-bal-status">${loading}</div>
            <div class="admin-settings admin-bm-stack">
                <form class="admin-card" id="bm-bal-run">
                    <h3>Balance now</h3>
                    <p class="muted">Even out pure, backpack slots or listing slots between the trade bots. Show the plan first to see the offers it would send.</p>
                    <label class="admin-field">What <select name="what"><option value="all">Everything</option><option value="pure">Pure</option><option value="slots">Backpack slots</option><option value="listings">Listing slots</option></select></label>
                    <div class="admin-bm-actions"><button type="submit" name="dry" value="1">Show the plan</button><button type="submit" name="dry" value="0" class="primary">Balance now</button></div>
                    <div id="bm-bal-plan"></div>
                </form>
                <form class="admin-card" id="bm-bal-move">
                    <h3>Move items to another bot</h3>
                    <p class="muted">Their sell listings come down first and go up again from the new bot.</p>
                    <div class="admin-row-fields">
                        <label class="admin-field">From <select name="from" required></select></label>
                        <label class="admin-field">To <select name="to" required></select></label>
                    </div>
                    <label class="admin-field">Asset IDs <textarea name="assetids" rows="3" class="admin-code" required placeholder="One per line or separated by commas"></textarea></label>
                    <div class="admin-card-foot"><button type="submit" class="primary">Move</button></div>
                </form>
                <div class="admin-card wide"><h3>Last moves</h3><div id="bm-bal-history">${loading}</div></div>
            </div>
            <div class="admin-settings admin-bm-stack" id="bm-bal-settings"></div>`
        const $ = (sel) => box.querySelector(sel)
        const settings = settings_card($('#bm-bal-settings'), { title: 'Balance settings', help: HELP.balance, ...scope_settings('balance') })

        const draw = async () => {
            const res = await bm('admin:balance:status')
            if(!box.isConnected){ return }
            if(res.status != 'ok'){ return failed(box, res) }
            const d = res.data || {}, bots = d.bots || []
            $('#bm-bal-status').innerHTML = `<div class="admin-bm-toolbar"><span>${pill(d.enabled, 'Balancing by itself', 'Only by hand')}${d.running ? ' <span class="admin-tag">moving items…</span>' : ''}</span>
                    <span class="muted">${d.lastRun ? `Last run ${ago(d.lastRun.at || d.lastRun.finished || d.lastRun)}` : ''}</span></div>
                <div class="admin-card admin-bm-slots">
                    ${table(['Bot', 'Backpack', 'Free', ...PURE.map((t) => t[0].toUpperCase() + t.slice(1)), 'Can give'], bots.map((b) => `<tr>
                        <td>${esc(b.name || b.steamid)}${b.ready === false ? ' <span class="admin-tag">not ready</span>' : ''}</td>
                        <td><span class="admin-bm-meter${b.slots?.low ? ' is-low' : ''}" style="--fill:${Math.min(100, Math.round((b.slots?.used || 0) / Math.max(1, b.slots?.capacity || 1) * 100))}%"></span>${num(b.slots?.used)} / ${num(b.slots?.capacity)}</td>
                        <td>${num(b.slots?.free)}${b.slots?.low ? ' <span class="admin-tag tag-bad">almost full</span>' : b.slots?.balanced ? ' <span class="admin-tag tag-warn">evened out</span>' : ''}</td>
                        ${PURE.map((t) => `<td>${num(b.pure?.[t])}</td>`).join('')}
                        <td>${PURE.filter((t) => b.canGive?.[t]).map((t) => `${num(b.canGive[t])} ${t}`).join(', ') || '–'}</td></tr>`), 'No trade bots.')}
                    ${d.average ? `<p class="admin-help">Average: ${num(d.average.freeSlots)} free slots, ${PURE.map((t) => `${num(d.average.pure?.[t])} ${t}`).join(', ')}.${d.listingSlots?.unlistedForSlots ? ` ${num(d.listingSlots.unlistedForSlots)} items wait for a listing slot.` : ''}</p>` : ''}
                </div>`
            $('#bm-bal-history').innerHTML = table(['When', 'Kind', 'From', 'To', 'Items', ''], (d.history || []).map((h) => `<tr><td>${ago(h.at)}</td><td>${words(h.kind)}</td>
                <td>${esc(name_of(bots, h.giver))}</td><td>${esc(name_of(bots, h.receiver))}</td>
                <td>${h.counts ? esc(Object.entries(h.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')) : num(h.count)}</td>
                <td>${h.ok === false ? `<span class="admin-error">${words(h.error || 'failed')}</span>` : ''}</td></tr>`), 'Nothing moved yet.')
            for (const name of ['from', 'to']) {
                const select = $('#bm-bal-move')[name]
                const picked = select.value
                select.innerHTML = bots.map((b) => `<option value="${esc(b.steamid)}">${esc(b.name || b.steamid)}</option>`).join('')
                if(picked){ select.value = picked } else if(name == 'to' && bots[1]){ select.value = bots[1].steamid }
            }
        }
        const name_of = (bots, steamid) => bots.find((b) => b.steamid == steamid)?.name || steamid || '–'

        box.addEventListener('submit', async (e) => {
            e.preventDefault()
            const form = e.target
            if(form.id == 'bm-bal-run'){
                const dry = e.submitter?.value != '0'
                if(!dry && !confirm('Send the offers between the bots now?')){ return }
                const res = await busy(e.submitter, () => bm('admin:balance:run', { what: form.what.value, dryRun: dry }))
                const plan = res.data?.plan || []
                if(res.status != 'ok'){ $('#bm-bal-plan').innerHTML = error_line(res); return }
                $('#bm-bal-plan').innerHTML = `<h4 class="admin-bm-sub">${dry ? 'The plan' : 'Sent'}</h4>` + table(['Kind', 'From', 'To', 'Items'], plan.map((p) => `<tr><td>${words(p.kind)}</td><td>${esc(p.giverName || p.giver || '–')}</td><td>${esc(p.receiverName || p.receiver || '–')}</td>
                    <td>${p.counts ? esc(Object.entries(p.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')) : num(p.count ?? p.items?.length)}</td></tr>`), 'Nothing to even out.')
                if(!dry){ toast(res, 'Balanced.'); draw() }
            }
            if(form.id == 'bm-bal-move'){
                const assetids = form.assetids.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
                if(form.from.value == form.to.value){ return iziToast.error({ title: 'Error', message: 'Pick two different bots.' }) }
                const res = await busy(form.querySelector('[type="submit"]'), () => bm('admin:balance:move', { from: form.from.value, to: form.to.value, assetids }))
                if(toast(res, 'Moved.')){ form.assetids.value = ''; draw() }
            }
        })

        await Promise.all([draw(), settings.load()])
        ctx.watch(['balance', 'bots'], () => { draw(); settings.changed() })
        ctx.every(30000, draw)
    }

    /* ========================= BLACKLIST ========================= */

    const MIN = 60 * 1000, HOUR = 60 * MIN
    const tab_blacklist = async (box, ctx) => {
        box.innerHTML = `<div class="admin-settings">
                <form class="admin-card" id="bm-bl-add">
                    <h3>Blacklist a user</h3>
                    <p class="muted">The bots ignore their offers, chat and trade requests.</p>
                    <label class="admin-field">SteamID64 <input type="text" name="steamid" required pattern="\\d{17}" inputmode="numeric" maxlength="17"></label>
                    <label class="admin-field">Reason <input type="text" name="reason" maxlength="200" placeholder="manual"></label>
                    <label class="admin-field">For <span class="admin-input-unit"><input type="number" name="hours" min="0" step="any" placeholder="0"><em>hours</em></span><span class="admin-help">0 or empty: for good.</span></label>
                    <div class="admin-card-foot"><button type="submit" class="primary">Blacklist</button></div>
                </form>
                <form class="admin-card" id="bm-bl-check">
                    <h3>Check a user</h3>
                    <div class="admin-inline-form"><input type="text" name="steamid" required pattern="\\d{17}" inputmode="numeric" maxlength="17" placeholder="SteamID64"><button type="submit">Check</button></div>
                    <div id="bm-bl-result"></div>
                </form>
                <div class="admin-card wide"><h3>Blacklisted now</h3><div id="bm-bl-list">${loading}</div></div>
                <div class="admin-card wide" data-card="bm-rules"><h3>Automatic blacklist</h3>
                    <p class="muted">A user who does one of these "limit" times within the time window is blacklisted for the ban time (warned at "warn at", 0 = no warning).</p>
                    <div id="bm-bl-rules">${loading}</div>
                    <div class="admin-card-foot"><span class="admin-dirty">Unsaved changes</span><button type="button" data-discard>Discard</button><button type="button" class="primary" data-save disabled>Save</button></div>
                </div>
            </div>`
        const $ = (sel) => box.querySelector(sel)
        let rules = null

        const draw_list = async () => {
            const res = await bm('admin:blacklist:list')
            if(!box.isConnected){ return }
            if(res.status != 'ok'){ return failed(box, res) }
            $('#bm-bl-list').innerHTML = table(['User', 'Why', 'Until', 'Times', ''], (res.data || []).sort((a, b) => (a.until || Infinity) - (b.until || Infinity)).map((b) => `<tr>
                <td>${profile(b.steamid)}</td><td>${esc(b.reason)}</td><td>${b.until ? `${when(b.until)} <span class="muted">${later(b.until)}</span>` : 'for good'}</td><td>${num(b.bans)}</td>
                <td class="admin-bm-cell-actions">${act('admin:blacklist:remove', { steamid: b.steamid }, 'Remove', { ok: 'Removed from the blacklist.' })}</td></tr>`), 'Nobody is blacklisted.')
        }
        const RULE_FIELDS = [['limit', 'Limit', 'times'], ['warnAt', 'Warn at', 'times'], ['window', 'Within', 'min', MIN], ['ban', 'Ban for', 'h', HOUR]]
        const rule_value = (r, [key, , , scale]) => r?.[key] == null ? '' : scale ? r2(r[key] / scale) : r[key]
        const draw_rules = async () => {
            const res = await bm('admin:blacklist:rules')
            if(!box.isConnected){ return }
            const el = $('#bm-bl-rules')
            if(res.status != 'ok'){ el.innerHTML = error_line(res); return }
            rules = res.data
            el.innerHTML = table(['Rule', ...RULE_FIELDS.map(([, label]) => label), ''], Object.entries(rules.rules || {}).map(([type, r]) => {
                const def = rules.defaults?.[type] || {}
                const custom = RULE_FIELDS.some((f) => rule_value(r, f) !== rule_value(def, f))
                return `<tr data-rule="${esc(type)}"><td><strong>${esc(r.label || def.label || type.replace(/_/g, ' '))}</strong><span class="admin-help">${esc(type)}</span></td>
                    ${RULE_FIELDS.map((f) => `<td><span class="admin-input-unit"><input type="number" min="0" step="any" data-field="${f[0]}" value="${esc(rule_value(r, f))}" aria-label="${f[1]}"><em>${f[2]}</em></span>
                        <span class="admin-help">default ${esc(rule_value(def, f))}</span></td>`).join('')}
                    <td class="admin-bm-cell-actions">${custom ? `<button type="button" data-rule-reset="${esc(type)}">Default</button>` : ''}</td></tr>`
            }), 'No rules.')
            $('[data-card="bm-rules"]').classList.remove('is-dirty', 'is-stale')
            $('[data-card="bm-rules"] [data-save]').disabled = true
        }
        const rule_card = $('[data-card="bm-rules"]')
        rule_card.addEventListener('input', () => { rule_card.classList.add('is-dirty'); rule_card.querySelector('[data-save]').disabled = false })
        rule_card.querySelector('[data-discard]').addEventListener('click', draw_rules)
        rule_card.querySelector('[data-save]').addEventListener('click', async (e) => {
            const patch = {}
            for (const row of rule_card.querySelectorAll('[data-rule]')) {
                const type = row.dataset.rule, r = rules.rules[type] || {}
                const out = {}
                for (const f of RULE_FIELDS) {
                    const input = row.querySelector(`[data-field="${f[0]}"]`)
                    if(input.value.trim() === '' || String(Number(input.value)) === String(rule_value(r, f))){ continue }
                    if(f[0] == 'window'){ out.windowMin = Number(input.value) } else if(f[0] == 'ban'){ out.banHours = Number(input.value) } else { out[f[0]] = Number(input.value) }
                }
                if(Object.keys(out).length){ patch[type] = out }
            }
            if(!Object.keys(patch).length){ return draw_rules() }
            const res = await busy(e.currentTarget, () => bm('admin:blacklist:rules:update', { rules: patch }))
            if(toast(res, 'Rules saved.')){ draw_rules() }
        })
        rule_card.addEventListener('click', async (e) => {
            const reset = e.target.closest('[data-rule-reset]')
            if(!reset){ return }
            const res = await busy(reset, () => bm('admin:blacklist:rules:update', { rules: { [reset.dataset.ruleReset]: null } }))
            if(toast(res, 'Back to the default.')){ draw_rules() }
        })

        box.addEventListener('submit', async (e) => {
            e.preventDefault()
            const form = e.target
            if(form.id == 'bm-bl-add'){
                const res = await busy(form.querySelector('[type="submit"]'), () => bm('admin:blacklist:add', { steamid: form.steamid.value.trim(), reason: form.reason.value.trim() || 'manual', hours: Number(form.hours.value) || 0 }))
                if(toast(res, 'Blacklisted.')){ form.reset(); draw_list() }
            }
            if(form.id == 'bm-bl-check'){
                const res = await busy(form.querySelector('[type="submit"]'), () => bm('admin:blacklist:check', { steamid: form.steamid.value.trim() }))
                const d = res.data || {}
                $('#bm-bl-result').innerHTML = res.status != 'ok' ? error_line(res)
                    : d.protected ? '<p class="admin-bm-yes">Protected: one of our bots or an admin, never blacklisted.</p>'
                    : d.entry ? `<p class="admin-error">Blacklisted ${d.entry.until ? `until ${when(d.entry.until)}` : 'for good'}: ${esc(d.entry.reason)}.</p>${d.message ? `<p class="admin-help">The bots tell them: ${esc(d.message)}</p>` : ''}`
                    : '<p class="admin-bm-yes">Not blacklisted.</p>'
            }
        })
        actions(box, draw_list)

        await Promise.all([draw_list(), draw_rules()])
        ctx.watch(['blacklist'], () => { draw_list(); rule_card.classList.contains('is-dirty') ? rule_card.classList.add('is-stale') : draw_rules() })
        ctx.every(60000, draw_list)
    }

    /* ========================= SECTION ========================= */

    const TABS = [['overview', 'Overview', tab_overview], ['bots', 'Bots', tab_bots], ['trading', 'Trading', tab_trading], ['stock', 'Stock', tab_stock],
        ['listings', 'Listings', tab_listings], ['prices', 'Prices', tab_prices], ['buyorders', 'Buy orders', tab_buyorders], ['balance', 'Balance', tab_balance], ['blacklist', 'Blacklist', tab_blacklist]]

    sections.bots = async (root, wanted) => {
        const [name, , draw] = TABS.find(([t]) => t == wanted) || TABS[0]
        root.innerHTML = head('Bot manager', 'bot_manager\'s own settings and state, read from it live. Changes apply right away.', '<button type="button" data-bm-refresh>Refresh</button>') + `
            <nav class="admin-tabs admin-bm-tabs" aria-label="Bot manager">${TABS.map(([t, label]) => `<a href="#bots/${t}"${t == name ? ' class="active" aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
            <div id="bm-body" class="admin-bm-page">${loading}</div>`
        root.querySelector('[data-bm-refresh]').addEventListener('click', () => window.dispatchEvent(new HashChangeEvent('hashchange')))
        const box = root.querySelector('#bm-body')

        // pushes from bot_manager (admin.js → on_live): run the tab's watchers for that scope, once per burst
        const watchers = [], timers = [], due = new Map()
        let flush = null
        const ctx = {
            watch: (scopes, fn) => watchers.push({ scopes, fn }),
            every: (ms, fn) => timers.push(setInterval(() => { if(!document.hidden && box.isConnected){ fn() } }, ms))
        }
        const off = on_live((type, event) => {
            const scope = type == 'bot_manager_stock' ? 'stock_updated' : type == 'bot_manager' ? event?.scope : null
            if(!scope){ return }
            for (const w of watchers) {
                if(w.scopes ? w.scopes.includes(scope) : scope != 'stock_updated'){ due.set(w.fn, type == 'bot_manager_stock' ? event : undefined) }
            }
            clearTimeout(flush)
            flush = setTimeout(() => { const list = [...due]; due.clear(); list.forEach(([fn, arg]) => fn(arg)) }, 700)
        })

        try { await draw(box, ctx) } catch (err) { console.log(err); box.innerHTML = `<p class="admin-error">This page failed: ${esc(err.message)}</p>` }
        return () => { off(); clearTimeout(flush); timers.forEach(clearInterval) }
    }

    // the old Stock limits and Listings pages: bot_manager does both now
    sections.stock = () => { location.replace('#bots/stock') }
    sections.listings = () => { location.replace('#bots/listings') }
})();
