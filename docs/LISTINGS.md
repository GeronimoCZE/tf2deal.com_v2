# Backpack.tf listings

The admin panel has a **Listings** page (`/admin#listings`):

- **List only these types and qualities:** tick type × quality cells (e.g. Unique cosmetics, Strange weapons). When
  it is on, the bots only list items that match a ticked cell. It can limit buy listings, sell listings or both.
- **Never list:** items the bots don't list at all.
- **New listing:** a buy or sell listing for one bot, with its own price. It stays listed until it is taken down.
- **All listings:** every buy and sell listing of every bot, with filters (side, bot, made by the bots or by hand,
  name). Each one can be taken down; one the bots made can also be taken down and added to Never list.

The bot server makes and keeps the listings on backpack.tf, so it has to do the work below. Until it does, the page
shows the rules and the listings made by hand, and says the bot server sent no listings.

## 1. The rules (live setting `listings`)

The bot server reads it like the other settings, on the `/settings` socket (see `SETTINGS.md`): `settings:init`
after connecting, `settings:changed` after every change. Apply it right away: take down the listings it no longer
allows and list what it allows again.

```json
"listings": {
  "enabled": true,
  "rules": [
    { "quality": "6", "type": "group:cosmetic" },
    { "quality": "11", "type": "group:weapon" },
    { "quality": "6", "type": "tool paint" }
  ],
  "buy": true,
  "sell": false,
  "exclude": ["Team Captain"]
}
```

- `rules`: an item matches a rule when its `qualityID` equals `quality` (`""` = any quality) and its `type` (from
  `item_instances`) equals `type`, any case. `group:weapon` matches `weapon` and every type starting with `weapon `.
- `buy` / `sell`: which side the rules limit. Above, the bots only buy Unique cosmetics, Strange weapons and Unique
  paints, but keep selling everything they hold.
- `exclude`: items (by `bp_sku`, any case) never listed on either side, also when `enabled` is false.

```js
const type_matches = (rule_type, type) => {
  if (!rule_type) return true;
  const t = String(type || '').trim().toLowerCase(), r = rule_type.trim().toLowerCase();
  if (r.startsWith('group:')) { const g = r.slice(6); return t === g || t.startsWith(g + ' '); }
  return t === r;
};

// item: the item_instances document (bp_sku, qualityID, type); side: 'buy' | 'sell'
const may_list = (item, side, l = settings.listings) => {
  const key = (s) => String(s || '').trim().toLowerCase();
  if (l.exclude.some((name) => key(name) === key(item.bp_sku))) return false;
  if (!l.enabled || !l[side]) return true;
  return l.rules.some((r) => (!r.quality || r.quality === String(item.qualityID)) && type_matches(r.type, item.type));
};
```

The rules are not applied to listings made by hand (below).

## 2. Events on the bots socket

The website is a socket.io client of the bot server (`BOTS_ENDPOINT?server=web&server_token=...&server_secret=...`,
the same connection as `fp_data` and `TradeOffer`). It sends these; each one with an ack callback, answer
`{ success: true, ... }` or `{ success: false, error: "why" }`.

| Event (site → bot server) | Payload | Answer |
|---|---|---|
| `listings:get` | `{}` | `{ success: true, listings: [Listing] }`: every listing of every bot right now. Answer within 10 seconds, from what the bot server keeps in memory |
| `listings:create` | a manual listing (below) | `{ success: true, listing: Listing }` once it is on backpack.tf |
| `listings:remove` | `{ id, bot, manual_id? }` | `{ success: true }` once it is gone. `manual_id` is set for a listing made by hand |
| `listings:manual` | `[manual listing]` (no ack) | – |

A `Listing` in the answers (backpack.tf's own listing objects work too: `intent`, `currencies`, `item.name`,
`item.id`, `listedAt`, `bumpedAt` are read):

```json
{
  "id": "440_76561198111111111_1a2b3c",
  "bot": "76561198111111111",
  "intent": "sell",
  "bp_sku": "Strange Professional Killstreak Rocket Launcher",
  "assetid": "16912048916",
  "price": { "keys": 1, "metal": 22.33 },
  "details": "...",
  "manual_id": "",
  "created": 1792390000000,
  "bumped": 1792393600000
}
```

`manual_id` is empty for the bots' own listings and the manual listing's id for one made by hand. Times may be in
seconds or milliseconds.

### Listings made by hand

The admin picks the bot, buy or sell, the item and the price. The site keeps them in the `manual_listings`
collection and sends them like this:

```json
{
  "manual_id": "6716f0c2a1b2c3d4e5f60718",
  "bot": "76561198111111111",
  "intent": "buy",
  "bp_sku": "Rocket Launcher",
  "ks": 3,
  "assetid": "",
  "price": { "keys": 0, "metal": 33.11 },
  "details": "",
  "created": 1792390000000
}
```

- `intent: "buy"`: a buy order for `bp_sku`. `ks` 1–3 means its Killstreak / Specialized / Professional version.
- `intent: "sell"`: sells the copy with `assetid` that this bot holds.
- `details`: the listing text; empty = the bot's usual text.
- The price is the admin's own. When someone trades on that listing, the bot accepts that price for it.

`listings:create` comes once, when the admin makes one. `listings:manual` carries the whole list (made by hand, all
bots) when the bots socket connects and after every change. List the ones that aren't listed yet, take down manual
listings that are no longer in the list, and keep the rest. Don't remove or re-price them in your own clean-ups
or price updates, and don't apply the rules to them.

### Optional, bot server → site

| Event | Payload | Effect |
|---|---|---|
| `listings:changed` | – | The admin page asks for the listings again on its next load |
| `listings:manual_status` | `[{ manual_id, status: "listed" \| "failed", listing_id, error }]` | Shows "Listed" or "Failed: error" next to a listing made by hand that was listed later (for example after the bot server came back) |

Without `listings:manual_status`, a listing made by hand shows as listed once `listings:get` returns it with its
`manual_id`.

## Test it

1. Admin → Listings shows "From the bot server, just now." and the listings once `listings:get` answers.
2. Tick a cell, Save rules: the bot server gets `settings:changed` with `changed: ["listings"]`.
3. Make a sell listing for one bot: it shows "Listed" after `listings:create` answers.
4. Take it down: `listings:remove` comes with its `manual_id`; it is gone from the list.
