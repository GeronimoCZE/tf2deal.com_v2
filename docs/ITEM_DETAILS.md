# Item details: custom names, custom descriptions, inspect links

A right-click on an item on the trade page or on the item page (Buy / Sell) opens a window with everything about
that copy: quality, type, classes, killstreak, paint, spells, parts, its asset ID, links (item page, backpack.tf,
TF2 Wiki, Steam Market, Steam inventory) and **Inspect in game**. On phones and tablets a tap on the item's tooltip
opens it. A renamed item also shows its custom name in the tooltip.

The site reads three more fields from each copy's `at` (attachments), next to `killstreaker`, `sheen`, `paint`,
`strangeParts` and `spells`:

| field        | what                                                        | example |
|--------------|-------------------------------------------------------------|---------|
| `customName` | the name given with a Name Tag, without Steam's `''` quotes | `My Lucky Hat` |
| `customDesc` | the text given with a Description Tag, without the quotes   | `Won at a LAN` |
| `inspect`    | Steam's "Inspect in Game..." link of that copy              | `steam://rungame/440/76561202255233023/+tf_econ_item_preview%20S76561198000000001A1234567890D1234567890123456789` |

The site never makes these up: a copy without them shows no custom name and a greyed-out "Inspect in game". The
inspect link may also come with Steam's `%owner_steamid%` and `%assetid%` still in it; the site fills them in. Only a
`steam://rungame/440/.../+tf_econ_item_preview...` link is shown.

## What the bot server needs (bot_manager)

Steam already sends all three with every inventory item: a renamed item's `name` is in `''quotes''` and its
`fraudwarnings` say "This item has been renamed", a custom description is a description line in `''quotes''`, and
`actions` holds the "Inspect in Game..." link (TF2 has one for some items, such as decorated weapons and war paints).

1. In `src/bot/logicHandler.js`, add this function (next to `buildItems`):

```js
// Custom name, custom description and Steam's inspect link of one item, for the site's item info window.
// desc: the item's Steam description (or the item itself in the older format), owner: whose inventory it is.
export function itemExtras(desc, owner, assetid) {
    const extras = {};
    const quoted = (text) => {
        const match = String(text ?? '').trim().match(/^''([\s\S]+)''$/);
        return match ? match[1].trim().slice(0, 200) : null;
    };

    const renamed = (desc?.fraudwarnings || []).some((w) => String(w).includes('renamed'));
    const customName = renamed ? quoted(desc?.name) : null;
    if (customName) extras.customName = customName;

    for (const d of desc?.descriptions || []) {
        const text = quoted(d?.value);
        if (text) { extras.customDesc = text; break; }
    }

    const inspect = (desc?.actions || []).find((a) => String(a?.link || '').includes('tf_econ_item_preview'));
    if (inspect && owner && assetid) {
        extras.inspect = String(inspect.link).replace('%owner_steamid%', owner).replace('%assetid%', assetid);
    }
    return extras;
}
```

2. In `buildItems`, add the extras to `attachments` in both branches:

```js
// first branch (data.descriptions):
const attachments = {
    ...(killstreaker && { killstreaker }),
    ...(sheen && { sheen }),
    ...(paint && { paint }),
    ...(strangeParts.length && { strangeParts }),
    ...(spells.length && { spells }),
    ...itemExtras(desc, steamid, asset.assetid)
};

// second branch (an array of items):
    ...itemExtras(asset, steamid, asset.assetid)
```

`buildItems` already gets the owner (`steamid`: the visitor for their inventory, the bot for the bots' own), and
`at` already travels to the site whole (user inventory, bot stock, trade offers), so nothing else changes.

3. Restart the bot server. Visitors' inventories show the new details on their next load. Copies the bots already
hold get them once the bot server reads them from Steam again; until then they show no custom name or inspect link.
