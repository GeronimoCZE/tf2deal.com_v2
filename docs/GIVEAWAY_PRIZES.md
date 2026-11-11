# Giveaway prizes on the bank bot (what bot_manager has to do)

The website now runs giveaways with a real prize from the bot accounts:

1. In Admin → Giveaways the owner picks the prize from **every tradable item on the bots, unpriced items too**.
2. Starting the giveaway **moves the item to the bank bot** and protects it: no site trade, incoming offer, chat
   command, buy order offer, listing or balance move may take it. Only the winner's offer can.
3. When the giveaway ends the site draws a random winner and asks bot_manager to **send the winner an offer from the
   bank bot** with only the prize in it (nothing asked in return).
4. A cancelled giveaway (or one nobody entered) **releases** the item: it stays on the bank bot as a normal item.

The site already does its side (`src/service/giveaway_prize.js`). It talks to bot_manager over the socket it keeps
open to it, with the same protocol as the rest of the admin API (`ADMIN_SOCKET_API.md`):
`socket.emit('<event>', { admin, ...payload }, ack)`, ack `{ success: 1, data }` or `{ success: 0, error: '<code>' }`.
Register the events below with `def(...)` in `src/services/adminSocket.js` (scope `giveaway`) so they show up in
`admin:handlers`: **the site only turns the prize picker on when `admin:giveaway:items` is listed there.** Until then
Admin → Giveaways says bot_manager doesn't have giveaway prizes yet and a giveaway can't be started.

## Bank bot

One bot account keeps the prizes. Best a `warehouse` account (no backpack.tf listings, no site trades). Whichever
account it is, while it holds a reserved prize that copy must be left alone (see Protection).

Save the choice in `runtime_settings` (e.g. `{ key: 'giveaway', value: { bankBot: '<steamid>' } }`).

### `admin:giveaway:bank`

Payload: none. Answer:

```json
{ "bank": "7656119...", "candidates": [ { "steamid": "7656119...", "name": "tf2deal.com warehouse 1", "type": "warehouse", "online": true } ] }
```

`bank` is `null` until one is chosen. `candidates` = every bot account (running or not), warehouse accounts first.

### `admin:giveaway:bank:set` (mutates)

Payload `{ steamid }`. Errors: `invalid_steamid`, `bot_not_found` (no such account). Answer like `admin:giveaway:bank`.
Changing the bank bot doesn't move prizes already reserved: they stay where they are until they're sent or released.

## Picking the prize

### `admin:giveaway:items`

Payload `{ query: string, offset: number, limit: number (max 120) }`. Answer:

```js
{
  "total": 1234,
  "items": [
    {
      "assetid": "12345678901",
      "bot": "7656119...",            // steamid of the bot holding it
      "botName": "tf2deal.com ⚡ bot 2",
      "bp_sku": "Strange Team Captain", // our item name; null for an unpriced item that matches no DB item
      "name": "Strange Team Captain",   // what to show: bp_sku, else the Steam market_hash_name / name
      "image": "https://community.cloudflare.steamstatic.com/economy/image/<icon_url>/128fx128f",
      "qualityID": 11,
      "effectID": 0,
      "priced": true,                  // false = no DB price (unpriced)
      "onBank": false                  // it's on the bank bot already
    }
  ]
}
```

- Every **tradable** item of every running bot (trade and warehouse accounts): the priced copies
  (`inventory.descriptions[*].stock.items`) **and** the unpriced ones (`inventory.items`).
- Not: keys, refined / reclaimed / scrap metal, items in an offer or trade right now (`isAssetInTrade`), items reserved
  for a giveaway already, non-tradable items.
- `query` matches the name, case-insensitive. Sort however is cheapest to do (by name is fine).
- `image`: painted copies with their own `icon_url` should use it (like docs/ITEM_DETAILS.md).

## Reserving it (moving it to the bank bot)

### `admin:giveaway:reserve` (mutates)

Payload `{ giveaway: '<24-hex id>', bot: '<steamid>', assetid: '<asset id>' }`.

1. Check the item is on that bot, tradable, not pure, not in a trade, not reserved. Errors: `no_bank_bot`,
   `bank_bot_offline`, `prize_not_found`, `prize_reserved`, `prize_pure`, `item_not_tradable`, `item_in_trade`.
2. Reserve it **at once** (so nothing can trade or move it from now on) and save the reservation in the DB, e.g. a
   `giveaway_prizes` collection: `{ giveaway, bot, assetid, from: { bot, assetid }, state, steamid, offerID, error,
   updated }`. It must survive a restart.
3. Answer straight away (don't wait for the move):

```json
{ "state": "moving", "bank": "<bank steamid>", "bot": "<steamid>", "assetid": "<asset id>",
  "item": { "bp_sku": "...", "name": "...", "image": "...", "qualityID": 6, "effectID": 0, "priced": true } }
```

   If the item is on the bank bot already, answer `state: 'held'` and skip the move.
4. Move it like `admin:balance:move` does (take its sell listing down first, internal offer giver → bank bot, accept,
   new asset id from the receipt). Then push `giveaway:prize` (below) with `state: 'held'` and the bank bot's
   `bot` + new `assetid`, or `state: 'move_failed'` + `error` if it didn't work (the reservation stays, on the old
   bot; the admin can press "Try moving it again", which calls `admin:giveaway:reserve` again with the original
   bot + asset id: accept that for a reservation in `move_failed`).

### Protection

While a reservation exists (`moving`, `held`, `sent`, `move_failed`...), that copy:

- is **not** in the site's bot inventory (trade page, /items stock counts) and not counted in stock limits;
- gets **no** backpack.tf sell listing, and is ignored by listing sync and price checks;
- is never given in a site trade, a counter offer, an accepted incoming offer, a chat command trade or a buy order
  offer (an incoming offer asking for it is declined or ignored like for an item we don't have);
- is never moved by the bot balance (pure / slots / listing slots) or by `admin:balance:move`;
- keeps its reservation when its asset id changes (follow it through the receipt like holds do).

Simplest: one `Set` of reserved asset ids checked wherever `isAssetInTrade` is checked, plus filtering the reserved
copies out where the site inventory and listings are built.

## Sending it to the winner

### `admin:giveaway:send` (mutates)

Payload `{ giveaway, steamid, tradelink, message }`. The bank bot sends an offer to `tradelink` giving only the prize,
asking nothing, with `message` as the offer message, and confirms it (mobile confirmation like other bot offers).

Answer `{ "state": "sent", "offerID": "1234567890" }`. Errors: `prize_not_found`, `prize_not_held` (still moving or
move failed), `bank_bot_offline`, `invalid_trade_link` (Steam says the link is wrong), `trade_hold` (the winner can't
trade: escrow, trade ban, Steam Guard), `offer_open` (an offer for this prize is open already), `send_failed` (any
other Steam error; put Steam's eresult in the log). On an error the reservation stays as it was: the site tries again
a few minutes later (2, 5, 10, 30, 60 min, then hourly) and the admin can press "Send the offer again".

Then push `giveaway:prize` when the offer changes: `accepted` (the reservation is done: delete it), `declined`,
`canceled`, `expired` (the reservation stays `held`; the admin can send it again), or `failed`.

## Releasing it

### `admin:giveaway:release` (mutates)

Payload `{ giveaway }`. Delete the reservation: the item becomes a normal item of the bank bot again (it can be picked
for the next giveaway). If a move is still running, let it finish first. Errors: `prize_not_found` (the site treats
that as released too).

## Pushes and the list

### push `giveaway:prize`

`web_socket.socket.emit('giveaway:prize', { giveaway, state, bot, assetid, offerID, error })` whenever a reservation
changes: `held`, `move_failed`, `sent`, `accepted`, `declined`, `canceled`, `expired`, `released`.

### `admin:giveaway:prizes`

Payload: none. Answer: every reservation as `[{ giveaway, state, bot, assetid, offerID, error }]` (`state` of a
reservation waiting for its winner is `held`, of an open offer `sent`). The site calls it after every (re)connect and
takes bot_manager's word for each prize, so pushes missed while disconnected aren't lost.

## What the site does with it

- Admin → Giveaways: bank bot select (`admin:giveaway:bank` / `:set`), prize picker (`admin:giveaway:items`), the
  prize's state on the running giveaway, the winner's card (name, SteamID, trade link, trades, offer state, "Send the
  offer again").
- When the giveaway ends: draws a random entrant (Steam group checked again), notifies the winner, notifies every
  admin with the winner, archives the giveaway (`giveaway_archive` collection), then calls `admin:giveaway:send`.
  A winner without a trade link gets a notification asking for one; the offer goes out the moment they save it.
- Cancelled / no entries: `admin:giveaway:release`.
