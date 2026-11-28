# Key bank (/keys)

Visitors swap Mann Co. Supply Crate Keys for refined metal and back with the bank bots (the warehouse accounts,
"TF2deal.com Bank #N"), up to 5 keys a trade. bot_manager runs it (its `KEY_BANK.md`: key price tracking, forecast,
buy and sell prices, the 3-key pure reserve on each bank bot, incoming offers, backpack.tf key listings, sniping).
The site shows the prices and stock and passes requests on.

## The page

`/keys` (`src/view/keys.ejs`, `src/public/js/plugins/keys.js`, styles `src/public/scss/partials/views/_keys.scss`,
texts `keys.*` and `js.keys.*` in every `src/locales/<lang>.json`), linked in the menu and the footer:

Since 2026-11-28 (Nikolas: "make site page design simpler like devide screen in to 2 for buy and sell") it is one desk
split in two halves, **Buy keys** (left) and **Sell keys** (right), one under the other on narrow screens. Each half is a
whole swap on its own, top to bottom:

- what the visitor gives → what they get, as the two items' pictures;
- the price per key, big (Buy keys: our sell price, Sell keys: our buy price);
- 1 to 5 key pictures (the ones the picked bot can't do now are greyed out);
- the bank bot, a select (offline ones can't be picked) with a line under it saying how many keys it can sell / buy
  right now. Each half starts with the bot that can do the most for it and keeps the visitor's pick while that bot is
  online;
- the total (You pay / You get) and the request button (Sign in through Steam for visitors who aren't signed in).

Over the halves: the title and whether the prices are live; under them: the offer's fine print and that bank bots also
take offers sent by hand. The quote board, the bot list with meters, the 7-day price chart and "How it works" were
taken out in that change (bot_manager still sends `history`; the chat helper still uses the `keys.how_*` texts).

The page updates live (socket room `keybank`) and falls back to `/api/keys` every minute. When the status is older
than 5 minutes it says the prices may be out of date and requests wait.

## How the status gets here

bot_manager pushes `keybank:status` on the bots socket whenever it changes (and answers `keybank:get` when the site
connects). `src/service/key_bank.js` checks and trims it (`clean`), keeps the latest and sends it to the `keybank`
room. Shape:

```js
{ at, enabled, max_keys, price: { buy, sell } | null, market: { buy, sell, updated } | null,   // (bot_manager also sends price.since, not kept)
  bots: [{ steamid, name, avatar, level, online, can_buy, can_sell }],
  history: [[time, mid, buy, sell], ...] }   // hourly, last 7 days
```

`price.sell` is what the visitor pays for a key, `price.buy` what they get for one.

## A swap request

`POST /api/keys/trade` (signed in, trading on, the page's one-time hash, at most 6 a minute) with
`{ bot, side: 'buy' | 'sell', keys: 1..max, price }`. The site adds the visitor's Steam ID and trade URL and posts it to
bot_manager's `POST /keys/trade`. `price` is the per-key price the visitor saw: if it moved against them, bot_manager
answers `price_changed` with the new one and the page asks again; if it moved in their favour, the swap goes ahead at
the new price (the answer's `price` and `total` say so). bot_manager keeps each price at least 30 minutes unless keeping
it would lose money (its `priceHoldMin`), so this rarely happens. Other answers: `not_enough_stock`, `bot_unavailable`,
`key_bank_off`, `offer_open`, `user_not_enough_keys`, `user_not_enough_metal`, `bank_no_change`, `no_price`, each
with its own text (`js.keys.err.*`). On success the trade offer window opens as on /trade.

## Trade records

bot_manager marks these trades `keyBank: true`. They are in the visitor's own trade history (Profile → Trades), but
never in Latest trades: `service/latest_trades.js` skips `keyBank` trades and any trade of only keys and metal.
