# Item details in finished trades

"Latest trades" on the home page and Profile → Trades show each traded copy's details in its tooltip: paint,
Halloween spells, strange parts, killstreaker, sheen and custom name (plus the spell / part corner marks and a painted
copy's own picture). Each side of a trade is labelled: "Trader gave" (or "You gave" on the profile) and "Our bot gave".

## Where the details come from

bot_manager saves trades compactly (`toGive.items [{ bp_sku, a, q, ks, f, p, k }]`), without the copies' details.
The site (service/trade_records.js) looks for them in this order:

1. **The saved trade itself**: a copy's `at` (or `attachments`) and `icon_url`, or a Steam item's description lines.
2. **The bots' stock now** (`item_instances` → `stock.items`, by asset id).
3. **What the site remembers** (collection `copy_details`, service/copy_details.js): every 5 minutes the site saves
   the details of each copy in the bots' stock that has some, and keeps them 60 days after it last saw the copy. So a
   copy the bots sold still shows its details after it has left their stock.

Copies the bots held for at least one pass (5 minutes) before the trade are covered by 2 and 3, so most items the
bots **gave** show their details without any bot_manager change.

## Optional bot_manager change (covers what visitors gave too)

A copy a visitor gives the bots gets a new asset id from Steam, and the site never saw it in the visitor's hands,
so only bot_manager can tell its details. When bot_manager saves a trade, it can add each copy's `at` (the same object
it keeps in stock: `killstreaker`, `sheen`, `paint`, `spells`, `strangeParts`, `customName`, `customDesc`) and, for
painted or festivized copies, `icon_url`:

```js
// where bot_manager builds a saved copy (both toGive and toReceive):
{ bp_sku, a, q, ks, f, p, k, ...(copy.at && Object.keys(copy.at).length ? { at: copy.at } : {}), ...(copy.icon_url ? { icon_url: copy.icon_url } : {}) }
```

Nothing else is needed: the site reads `at` first when it is there. Older trades keep showing what steps 2 and 3 find.
