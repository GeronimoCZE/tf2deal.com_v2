# Direct buy links

Share a link to one item in the bots' stock:

```
https://tf2deal.com/buy/16912048916
```

The number is the item's Steam assetid. Language links work too (`/de/buy/16912048916`).

## What the visitor sees

The home page opens with a small window:

- **One item has that assetid:** the item, its price and which bot has it, with a **Request trade** button.
- **Several items have that assetid:** all of them in a list. The visitor picks one, then presses **Request trade**.
- **No item has it** (sold, or a wrong number): "Item not available" and a link to the items page.
- **Not signed in:** the same window with **Sign in through Steam**. After signing in they come back to the link.

Nothing is sent until the button is pressed, so opening a link never starts a trade on its own. Link previews
(Discord, Steam chat) show the item's name, price and picture when exactly one item matches.

## What the bot server gets

The request goes to `BOTS_ENDPOINT/trade` like before, with `single_item: true`. The site looks the item up again
before sending, and only sends it if exactly one copy matches. `Site` now says which copy was picked:

```json
{
  "single_item": true,
  "partner_steamid": "7656119...",
  "tradeurl": "https://steamcommunity.com/tradeoffer/new/?partner=...&token=...",
  "User": { "hash": "..." },
  "Site": {
    "assetid": "16912048916",
    "hash": "...",
    "bot": "76561198222222222",
    "bp_sku": "Strange Team Captain",
    "ks": 0,
    "f": 0
  }
}
```

- `bot` is the steamid of the bot that holds the item (`ownerId` in the item's stock). It can be empty if the stock
  entry has no owner.
- `bp_sku` is the item's name in the database, so two items that share an assetid can be told apart.
- `ks` is the killstreak tier (0 to 3) and `f` is 1 for festivized.

When two copies match and nothing says which one, or the item is gone, the site answers the visitor itself and
sends nothing to the bot server.

Code: `src/service/buy_link.js` (lookup), `src/routes/router.js` (`buy_link`), `src/api/index.js` (`/create_trade`),
`src/public/js/plugins/buy_link.js` (the window).
