# Items worth 0.055 ref (half a scrap)

Some items, mostly craft weapons, are worth 0.055 ref: half a scrap. Two of them make a scrap. Visitors can trade
them on both sides of the trade page and on the item page. They are never listed on backpack.tf.

## What the site does

- An item is a half-scrap item when its price on that side is above 0 and under one scrap (0.11 ref): `sell` for a
  bot's item, `buy` for the visitor's. Prices of 0.05 and 0.055 both count. In totals each one is 0.055 ref, whatever
  the key price.
- Keys and metal only come in whole scraps, so the site pairs up the half-scrap items of both sides. When the
  difference is even, the paying side adds keys and whole scraps as usual. When it is odd, half a scrap is left over:
  TRADE stays off and a note under it asks the visitor to add or remove one.

  | Visitor gives | Bot gives | Metal |
  |---|---|---|
  | 1 half-scrap item | 1 half-scrap item | none |
  | 2 half-scrap items | – | the bot pays 1 scrap |
  | 3 half-scrap items | 1 half-scrap item | the bot pays 1 scrap |
  | a 1.33 ref hat | 2 half-scrap items | the bot pays 1.22 ref |
  | 1 half-scrap item | – | can't be sent: half a scrap left over |

- Item page: only an even number of copies of a half-scrap item can be sent.
- A direct buy link (`/buy/<assetid>`, `BUY_LINKS.md`) for one half-scrap copy is refused, because one copy alone is
  half a scrap.
- `/api/create_trade` sends the trade as before: every item with its own price (`buy` or `sell`, 0.05 or 0.055) and
  `total_pure.price`, the metal the paying side adds.
- Admin → Listings: the rules never list a price under one scrap, and a listing made by hand needs at least 0.11 ref
  (`LISTINGS.md`).

## What the bot server has to do

1. **Inventories.** Send items priced under one scrap in `/inventory`, `/inventory/user` and the single-item
   versions, priced like any other item (`sell`, `buy`: 0.055 or 0.05).
2. **Trade offers** (`POST /trade`). Count each half-scrap item as 0.055 ref. Check that the half-scrap items the
   visitor gives minus the ones the bot gives is an even number, and refuse the trade otherwise
   (`{ success: 0, message: "why" }`). Pay the rest in keys and whole scraps as usual.
3. **backpack.tf.** Never list them, on either side. `may_list` in `LISTINGS.md` already returns false for a price
   under one scrap; the bot server's copy needs the same first line.
4. **Stock limits** apply as for any other item.
