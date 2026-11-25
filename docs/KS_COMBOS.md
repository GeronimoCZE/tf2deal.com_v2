# Professional Killstreak combos: good ones at the price, bad ones for less

Nikolas 2026-11-25: a simplified Professional Killstreak tier list from the backpack.tf forum's chart, in two
categories: good sheen + killstreaker combos at the price we pay now, bad combos for less. "You can add additional
select element for all pro ks weapons that will show exact price."

|                          | TS   | VV   | HR   | M    | AE   | DD   | MG   |
|--------------------------|------|------|------|------|------|------|------|
| Fire Horns (FH)          | good | good | good | good | good | good | good |
| Tornado (T)              | good | good | good | good | bad  | bad  | bad  |
| Flames (F)               | good | good | bad  | good | bad  | bad  | bad  |
| Incinerator (I)          | good | bad  | bad  | bad  | bad  | bad  | bad  |
| Singularity (S)          | good | bad  | bad  | bad  | bad  | bad  | bad  |
| Cerebral Discharge (CD)  | good | bad  | bad  | bad  | bad  | bad  | bad  |
| Hypno-Beam (HB)          | bad  | bad  | bad  | bad  | bad  | bad  | bad  |

Sheens: TS Team Shine, VV Villainous Violet, HR Hot Rod, M Manndarin, AE Agonizing Emerald, DD Deadly Daffodil,
MG Mean Green.

## Who does what

- **item_manager** owns the table (setting `ks_bad_combos`) and the prices. Bad combos cost 10 % less to buy and to
  sell (`ks_low_end_discount_pct`), and are bought for at most their lower sell less 10 %.
  - A weapon's Professional Killstreak tier: its `killstreak` entry gets `low_end_sell`, `low_end_buy` and
    `bad_combos` (codes like `VV+CD`).
  - A Professional Killstreak Kit or Kit Fabricator: the item's `combo_price: { low_end_sell, low_end_buy, bad_combos }`.
  - `low_end_buy` 0 means bad combos aren't bought.
- **bot_manager** prices each copy by its sheen and killstreaker, marks a bad combo copy `bad_combo: true` with its
  own lower price, names the bad combos and their price in the backpack.tf listing notes, and counters offers that ask
  the good price for a bad combo.
- **The site** (this repo) shows it:
  - `src/public/js/plugins/ks_combos.js`: the table's names and initials, a copy's combo, an item's bad combo price.
    It imports nothing, so the server (`service/buy_link.js`, `routes/router.js`) loads it too.
  - The item page's **Combo** select (`view/item_page.ejs`, `public/js/main.js` `fill_combos` / `show_combo`): on a
    weapon's Professional Killstreak tier page and on a Professional Killstreak Kit / Kit Fabricator page, when the item
    has a bad combo price. "All combos", then "Good combos (17)" and "Bad combos (32), lower price". Picking one shows
    its exact Buy and Sell price and lists only copies with that combo. Under it, a line says what bad combos cost, or
    whether the picked combo is good or bad. `?combo=TS+FH` opens with a combo picked.
  - Copy prices (`public/js/plugins/trade.js` `copy_price`, `single_price`, `trade_price`): a copy the bot server marks
    `bad_combo` costs its own price, never the tier's or the item's (those are the good combos' price). The tooltip
    adds "bad combo, lower price" next to its sheen. A copy without the mark keeps the old rule (highest price), so a
    site running before bot_manager has the change never shows a price the bot wouldn't take.
  - Direct buy links (`service/buy_link.js`) price a bad combo copy the same way.

Texts are in all 8 languages: `item.combo`, `js.item.combo_*`, `js.trade.bad_combo`, news `ks_combos`. Sheen and
killstreaker names stay English, like item names; the initials are the ones in the bots' backpack.tf listings.
