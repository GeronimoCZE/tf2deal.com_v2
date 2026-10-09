# Live settings socket

Other apps (bot server, item server, a Discord bot, a script…) can read and change the site settings while
the site runs. Changes take effect right away: the website, the admin panel and every other connected app
get them in the same second.

- Where: socket.io namespace **`/settings`** on the website's own server and port, e.g. `https://tf2deal.com/settings`
- Code: `src/service/settings.js` (rules + saving) and `src/service/settings_socket.js` (the socket)
- Stored in MongoDB, collection `settings`, one document (`index` = `STEAM_GROUP_ID`)

## Connecting

Send the credentials in the socket.io `auth` object (never in the URL):

| Who | `auth` | Can |
|---|---|---|
| Your apps | `{ server_token: SERVER_TOKEN, server_secret: SERVER_SECRET, app: "bot server" }` | read + write |
| Read-only app (optional) | `{ read_token: SETTINGS_READ_TOKEN, app: "stats" }` | read |
| Admin panel | `{ admin_token }` (made by the site, 12 h) | read + write |

`SERVER_TOKEN` / `SERVER_SECRET` are the values the bot and item servers already use. `SETTINGS_READ_TOKEN` is
new and optional: add it to `.env` only if you want read-only clients. `app` is just a name shown in the admin panel.

Wrong or missing credentials: the connection is refused with `connect_error` → `err.message === "unauthorized"`.

```js
import { io } from "socket.io-client";

const live = io("https://tf2deal.com/settings", {
  auth: { server_token: process.env.SERVER_TOKEN, server_secret: process.env.SERVER_SECRET, app: "bot server" }
});

live.on("connect_error", (err) => console.log("settings socket:", err.message));
live.on("settings:init", ({ settings }) => apply(settings));                 // right after connecting (and after reconnects)
live.on("settings:changed", ({ settings, changed, by }) => apply(settings));  // after every change, from anyone

// change something: only the fields you send are changed
live.emit("settings:update", { trading_state: 0 }, (res) => {
  if (res.status !== "ok") console.log(res.message);
});
```

## Events

| Direction | Event | Payload |
|---|---|---|
| server → you | `settings:init` | `{ settings, version }` |
| server → you | `settings:changed` | `{ settings, changed: ["trading_state"], version, updated, by: { kind, name } }` |
| server → you | `settings:clients_changed` | `{ count }` (someone connected/disconnected) |
| you → server | `settings:get` | ack → `{ status: "ok", settings, version }` |
| you → server | `settings:update` | `(patch, ack)` → `{ status: "ok", settings, changed }` or `{ status: "error", message, errors }` |
| you → server | `settings:clients` | ack → `{ status: "ok", clients: [{ kind, name, can_write, since, address }] }` |

`settings:changed` always carries the complete settings, so you can just replace your copy.
Updates run one after another (two apps can't overwrite each other) and are limited to 30 per 10 seconds per connection.
A patch that changes nothing returns `changed: []` and is not broadcast.

## The settings

```json
{
  "trading_state": 1,
  "min_item_key": 0,
  "max_item_key": 20,
  "item_blacklist": ["Team Captain"],
  "announcement": { "enabled": false, "text": "", "level": "info" },
  "reviews": { "enabled": true, "trustpilot_url": "https://www.trustpilot.com/review/tf2deal.com" },
  "season": "auto",
  "extra": {},
  "version": 12,
  "updated": 1791113400000,
  "updated_by": "app:bot server"
}
```

| Field | Patch | What the website does with it |
|---|---|---|
| `trading_state` | `1` / `0` (or `true` / `false`) | `0` pauses trading: `/api/create_trade` refuses new trades, visitors get a notice live |
| `min_item_key`, `max_item_key` | number of keys, 0–100000, min ≤ max | stored and shared; meant for the bot/item servers |
| `item_blacklist` | a full list `["A", "B"]`, or `{ "add": ["A"], "remove": ["B"] }` | trades containing these items (by `bp_sku`, any case) are refused |
| `announcement` | any of `{ enabled, text (≤300), level: "info" \| "warning" \| "danger" }` | banner under the menu on every page, updated live |
| `reviews` | any of `{ enabled, trustpilot_url }` (an `https://` link, or `""`) | the star rating after an accepted trade; 4 and 5 stars get a button to `trustpilot_url` |
| `season` | `"auto"`, `"off"`, `"summer"`, `"halloween"` or `"smissmas"` | seasonal look; `auto` follows the TF2 events (dates from teamfortress.com, usual dates as a fallback) |
| `extra` | `{ "key": value }`; `null` removes a key | your own values (≤16 KB), the website ignores them |

`version`, `updated`, `updated_by` are set by the server. Unknown fields are refused, so typos don't go unnoticed.

## Website visitors

Browsers never see the full settings. On the default namespace every visitor gets
`site_settings` → `{ trading, announcement: { text, level } | null, reviews: { enabled, trustpilot_url }, version }` when one of those changes.

## Admin panel

`/admin#settings` edits the same settings and shows changes from other apps as they happen, plus which apps are connected.
REST for scripts behind the admin login: `GET /api/admin/settings`, `POST /api/admin/settings` with a patch as the body.
