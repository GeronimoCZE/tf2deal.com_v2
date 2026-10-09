# Changes

Seventeen rounds of edits to your existing files. The structure and code style stay the same. The full line-by-line
diff against your original upload is in `fixes.diff`.

- **Round 17** makes the look plainer (one faint border colour, quality only as a line under items, shadows
  only on pop-up windows), dresses the site up during the TF2 events and fixes "Trades today".
- **Round 16** shows tooltip prices as "keys" and "ref", makes the tooltip purple with smaller corners and
  tones down borders, coloured highlights and shadows across the site.
- **Round 15** (below) is a security pass.
- **Round 14** adds a notification bell, restyles the giveaway page and simplifies the item tooltip.
- **Round 13** adds Buy and Sell filters on the item page.
- **Round 12** makes trade offer updates clearer and more reliable, restyles the item tooltip and asks for
  a rating after an accepted trade.
- **Round 11** redesigns the menu on phones and tablets, restyles the menu dropdowns, fixes the item
  tooltip position and makes sure an accepted trade offer always reaches the user.
- **Round 10** rebuilds the admin panel, adds live settings over a socket for your other apps, and
  restyles the trade, item search and stack quantity modals, and adds subtle page animations.
- **Round 9** makes the item page's killstreak tier select work and fixes the sell/buy view.
- **Round 8** is a design pass: one look for every page, with the original navy and purple colors.
- **Round 7** makes sure item names are never translated, by the AI or by browsers.
- **Round 6** adds a free translator (Cloudflare Workers AI) next to the paid Claude one.
- **Round 5** opens the site in the visitor's language automatically, saves the language they pick, and adds
  AI translation for blog posts and giveaway descriptions.
- **Round 4** is real multilanguage support (8 languages, one URL per language), a cookie policy and a cookie
  consent banner.
- **Round 3** is SEO: correct canonical URLs, titles and descriptions, link previews, structured data, sitemap and
  robots.txt.
- **Round 2** connects the unfinished pages: the item page buy/sell, home page stacking, support tickets, blog,
  giveaways, profile pages, and the admin sections that run them.
- **Round 1** is the earlier bug-fix and loading pass.

Everything uses `.env` values you already have (`ADMIN_STEAMID`, `ADMIN_PASSWORD`, `API_KEY_STEAM`,
`STEAM_GROUP_ID`). The new values are optional and only turn on AI translation: `CLOUDFLARE_ACCOUNT_ID` +
`CLOUDFLARE_AI_TOKEN` (free, see Round 6) or `ANTHROPIC_API_KEY` (paid, see Round 5).

---

# Round 17: plainer look, TF2 event themes, trades today

## Plainer look

- Every panel, menu, button and input uses the same faint grey border, or none. The coloured outlines and
  highlights are gone; hover and selected states use a slightly lighter grey.
- Item quality is shown only by the coloured line under each item (item list, trade page, latest trades).
- Shadows are gone everywhere except pop-up windows. The pulsing dot next to "Live" in the admin panel is now
  a plain dot.
- The filter bars on the trade and item pages follow the event colours below.

## TF2 event themes

While a TF2 event runs, the site changes its home picture, background, menu bar, buttons, links and the
falling particles. Outside an event it looks as usual.

| Event | Look |
|---|---|
| Summer event | TF2 orange, a desert picture, warm background, drifting dust instead of snow |
| Scream Fortress | Purple with green and pumpkin orange, a night picture, rising fire ash instead of snow |
| Smissmas | The usual snowy cabin and snow, with red and green accents |

The dates come from the official update notes on teamfortress.com (for example "Scream Fortress XVIII runs
through November 7th, 2026" in the post of October 1). The server reads that page every 6 hours. If it can't
be read, or this year's event isn't announced yet, it uses the usual dates: summer July 1 to September 15,
Scream Fortress October 1 to November 10, Smissmas December 1 to January 7.

**Admin panel → Live settings → Seasonal theme** has Auto (default), Off, or one event forced on. It also
shows which event is on, until when, and when teamfortress.com was last read. Other apps can set it over the
live settings socket as `season` (see `SETTINGS.md`).

## Trades today

It always said 0 because the number came only from the bot server's `fp_data` report, which sends 0. The site
now counts the trades in its own database since midnight UTC (refreshed every minute). The bot's number is used
only if the database can't be reached.

## Latest trades

The home page shows the last 5 trades instead of 3.

---

# Round 15: security

**One thing to add to `src/config/.env`:** `SESSION_SECRET=` followed by a long random text of at least 32
characters. Until it is set, the site picks a random one at each start, so everyone gets signed out whenever the
server restarts. The old built-in default is gone, because anyone who knew it could fake a login.

## Sign-in and the admin panel
- **Admin panel:** after the password on `/login`, access is now kept in the server-side session. Before, it was a
  cookie named `authenticated`, which anyone could create in their own browser.
- **Admin password check:** it takes the same time whether the guess is close or not, and `/login` allows 10 tries
  per 15 minutes.
- **Login cookie:** it is now `HttpOnly`, `SameSite=Lax`, and `Secure` on https.
- **Live updates:** the live connection (trade offer updates, notifications) now takes the user from the signed-in
  session. Before, a page could claim any Steam ID and receive that user's trade updates.
- **Server-to-server keys:**
  - The checks for the bot/item server and the `/api/items` client keys use constant-time comparisons.
  - They now refuse access when the key is missing from `.env`. Before, a missing `CLIENT_TOKEN` let everyone in.

## Crashes and overload
- **Crash on malformed requests:**
  - Sending an object instead of text to `/api/rating` or `/api/user/update` could crash the whole server. These
    values are now checked.
  - Errors in the API and profile routes are caught and answered with "Server error".
  - Any unhandled error is logged instead of stopping the site.
- **Email check:** the old pattern could freeze the server for minutes on one crafted email. It is now a simple
  pattern with a length limit.
- **Upload sizes:** requests are capped at 1 MB (was 50 MB), and live-connection messages at 5 MB (was 100 MB).
- **Item search:** the search escapes its text before using it as a database pattern.
- **Bot list:** `/get-steambots` is cached for a minute and rate limited, so the page can no longer flood the bot
  server.
- **Trade requests:** `/api/create_trade` is limited to 6 per minute per user.

## Trade requests
- **Trade recipient:** the trade always goes to the signed-in user. The page can no longer pick another Steam ID.
- **Trade URL:** it is read from the account in the database, not from the browser cookie.
- **Trade hash:** it now has to exist and match.
- **Inventory filters:** only plain values are passed on to the bot server, so database operators like
  `{"$ne": null}` can't be slipped in.

## Pages
- **Values in page scripts:**
  - Every value placed inside a page's scripts is escaped, including the trade URL, email, Steam data and item
    data.
  - Before, a link like `/profile?new_user=</script><script>...` could run code in the visitor's browser.
- **Steam names:**
  - Steam names on profile pages and in the admin panel's pop-up messages are escaped.
  - A giveaway winner's Steam name can no longer run code in the admin panel.
- **Latest trades:** the "Latest trades" tiles escape item data from the bot server.
- **`/api/latest_trades`:** it returns only what the home page shows. It no longer includes Steam IDs or offer IDs.
- **Open redirect:** a link like `/en//other-site.com` used to redirect to that other site. It now stays on
  tf2deal.com.
- **Security headers:** every response now sends `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
  and `Permissions-Policy`, plus HSTS when `SITE_URL` is https. The `X-Powered-By` header is gone.

## Not changed (needs the bot server)
- **Admin password sent to the bot server:** the site still sends `ADMIN_PASSWORD` and `PASSWORD` to the bot
  server with every inventory and trade request, because the bot server expects them. Giving the bot server its
  own key would be safer.
- **`/api/items` keys:** the client keys are written in the public JavaScript, so treat them as public. They are
  not a password.

---

# Round 14: notifications, giveaway page, item tooltip

## Notification bell

There is now a bell in the menu, next to the language and account buttons on desktop and next to the search
button on phones. Only signed-in users see it, because giveaways need an account. The API (`/api/notifications`)
also requires sign-in. The red count shows what came in since the panel was last opened. Opening the panel clears
the count, and the new ones stay highlighted while it is open.

What shows up there:

| Notification | Who sees it | Added when |
| --- | --- | --- |
| New giveaway | every signed-in user | you start a giveaway in the admin panel |
| Giveaway ended, "X won Y" | every signed-in user | a giveaway ends (on time or with "End now") |
| You won the giveaway | the winner only | the same moment |
| Support replied | that user only | you reply to their ticket |
| Announcement | every signed-in user | you send one from Admin → Notifications |

- New notifications appear live on open pages, and the bell gives a small shake. Notifications for one user are
  loaded through their signed-in session, so they never travel over the socket.
- The texts are in all 8 languages, and item names stay in English. Announcements are shown exactly as you write
  them.
- "Seen" is saved on the account (`notifications_seen` on the user). The bell shows the latest 20 from the last
  60 days.
- **Admin → Notifications** sends an announcement to everyone, with an optional link, and lists and deletes what
  everyone sees.

Files:
- `model/Notification.js` (new)
- `service/notifications.js` (new)
- `js/plugins/notifications.js` (new)
- `scss/partials/_notifications.scss` (new)
- `api/index.js` (`GET /api/notifications`, `POST /api/notifications/seen`)
- `api/routes/admin.js` (notifications, and hooks on new giveaways and ticket replies)
- `service/giveaway.js` (winner notifications)
- `model/User.js`
- `nav.ejs`
- `main.js`
- `admin.ejs`
- `admin.js`

## Giveaway page

- The current giveaway is one card. The item sits on the left with a "Live" badge, and the details are on the
  right: a countdown with days, hours, minutes and seconds, the entry count, the requirements as a checklist that
  ticks or crosses after "Enter", and a full-width Enter button.
- On phones and narrow screens it stacks into one column.
- When no giveaway is running, the page shows a simple empty state.
- Previous giveaways are cards with the item, the winner's avatar and name, and the date.

Files:
- `giveaway.ejs`
- `scss/partials/views/_giveaway.scss`
- new `giveaway.*` texts in `locales/*.json`

## Item tooltip

The tooltip is one flat colour with one soft border. These are gone:
- the gradient
- the purple quality line on top
- the purple dividers
- the coloured pills for effect, festivized, spells and parts

Only the item name keeps its TF2 quality colour.

The styles are in `scss/partials/_trade_states.scss`. `css/style.css` was rebuilt, and its version is now `1.6.0`.

---

# Round 13: item page filters

The item page now has a filter bar between the toolbar and the item grid, on both Buy and Sell.

- **Only the filters that matter.** A filter appears only when the loaded copies actually differ on it. Most items
  show no bar at all. The possible filters are:
  - Bot (Buy only)
  - Paint
  - Spells
  - Strange parts
  - Sheen
  - Killstreaker
  - Festivized

  The killstreak tier is left out because the item page already has its own tier select.
- **Bot filter on Buy.** This filter works like the bot filter in the trade window: you pick one of your bots by
  name (from `/api/bots`) and see only that bot's copies. It only appears when the copies are spread over more
  than one bot.
- Each option shows how many copies it would leave, and options that would leave none are greyed out. The bar
  shows "2 of 7" and a Reset button while a filter is picked. If nothing matches, the grid shows a short message.
- Filtering happens in the browser. Picked filters stay when the inventory reloads and reset when you switch
  between Buy and Sell.
- The bar uses the same card style as the toolbar. On phones, the dropdowns span the full width. All
  labels are in the 8 languages.

Files:
- `js/plugins/item_filters.js` (new)
- `scss/partials/_item_filters.scss` (new)
- `trade.js`
- `item_page.ejs`
- `style.scss`
- `locales/*.json` (`js.item_filters`)
- `css/style.css` (rebuilt, version bumped to `1.5.0` in `head.ejs`)

---

# Round 12: trade offer updates, item tooltip, ratings

## Trade offer updates
- **Fixed:** a status update that arrived while the trade modal was closed (for example after a page reload, or after
  closing the modal to wait) failed with a script error, so "accepted", "declined" and the rest were never shown. The
  modal now opens with the new status in every case.
- A progress line at the top of the modal: Creating → Accept on Steam → Done. The current step moves, finished steps
  turn green, and a failed step turns grey or red.
- Clearer messages for every ending: declined because of a Steam trade hold (with the fix: Steam Guard Mobile
  Authenticator), counter offer, expired, items no longer available, offer did not match, no longer valid. The bot's
  numeric states ("3", "11"…) and texts like "declined trade hold" are both understood. "Invalid" used to show an
  empty modal.
- The bar under the menu (shown while the modal is closed) now says what the offer is doing ("Creating your trade
  offer…", "Your trade offer is ready. Click to open it.") and turns green when it is ready.
- The site asks the bot server for the offer status every 15 seconds instead of 30, right after the connection comes
  back, and when the user returns to the tab.

## Item tooltip
- Same style as the modals: dark navy card, a color line and name in the item's quality color (Unique, Strange,
  Unusual, …), prices as small key/ref chips, the unusual effect as a tag, and tidy label/value rows.
- Fades in softly instead of popping up.

## Rating after an accepted trade
- The "accepted" screen asks "How was your trade?" with 1 to 5 stars. The rating is saved on the site right away.
- 4 or 5 stars: a thank you and a green "Review us on Trustpilot" button. 1 to 3 stars: a box asking what we could do
  better, saved with the rating. Users are asked once per trade offer.
- Admin panel: a new **Ratings** page (average, how many of each star, newest ratings with comments, filter by stars,
  "traded" when the user has a finished trade, "opened Trustpilot" when they clicked through), a "Trade rating" number
  on the Overview, and a **Ratings after trades** card in Live settings to turn it on/off and change the Trustpilot link.
- The Trustpilot link is a setting (`reviews.trustpilot_url`), so other apps can change it over the settings socket too.
  It starts as `https://www.trustpilot.com/review/tf2deal.com`.
- Replaces the old Trustpilot widget on that screen, which never loaded (the Trustpilot script was not on the site).

Files: `src/public/js/plugins/trade.js`, `src/service/socket.js`, `src/public/scss/partials/_trade_states.scss` (new),
`src/model/Rating.js` (new), `src/api/index.js` (`POST /api/rating`), `src/api/routes/admin.js` (`GET /api/admin/ratings`),
`src/service/settings.js`, `src/model/SiteSetting.js`, `src/public/js/admin.js`, `src/view/admin/admin.ejs`,
`src/public/scss/partials/views/_admin.scss`, `src/locales/*.json` (all 8 languages), `SETTINGS.md`.

---

# Round 11: mobile menu and dropdowns

Same look as the Round 10 modals (dark navy card, purple accents, soft shadow, light motion).

- **Phones and tablets (1370px and below):** a slim bar with the logo, a search button and a menu button. The
  menu opens as a floating card under the bar and dims the page behind it. Inside, top to bottom: a search
  field, Trade / Items / Community / About (the current page is highlighted), your account, the language, and
  "Sign in with Steam" as a green button when signed out.
- **Community** opens in place inside the menu instead of a separate list. **Account links** (Profile, Trades,
  Wishlist, Giveaways, Admin, Settings, Sign out) are always visible in two columns. **Language** opens a
  two-column grid with flags and a check on the current one.
- The menu closes with the X, a tap outside, or Esc, and scrolls on its own if the screen is short. The menu
  button works with the keyboard and tells screen readers whether the menu is open.
- **Desktop dropdowns** (Community, language, account) use the same card style, and the current language has a
  check mark. The desktop layout itself is unchanged.
- **Item tooltip position fixed.** The tooltip that shows an item's price and details appeared too high or low
  (worse the further you scrolled). The cause was the page fade-in animation leaving an invisible "transform" on
  the page content, which shifts anything positioned on the screen inside it. The fade-in now cleans up after
  itself, and the same fix is applied to the profile "My trades" box, which had the same problem
  (`_motion.scss`, `views/_profile.scss`).
- **Accepted trade offers now always reach the user.** The site remembered only one connection per user and forgot
  the user completely as soon as any of their tabs closed. A page reload, a second tab, or moving to another page
  during a trade was enough, and the "accepted" update from the bot server was then dropped. Now every open tab
  of a user gets offer updates, the user is only forgotten when their last tab closes, and a final update
  (accepted, declined, expired…) that arrives while no page is open is shown when they next open one (within
  10 minutes). Numeric bot states ("3") are also understood as their names ("accepted").
  (`src/service/socket.js`, `src/api/routes/user.js`)
- Files: `src/view/partials/nav.ejs`, `src/public/scss/partials/_nav_refresh.scss` (new),
  `src/public/scss/style.scss`, `src/public/js/main.js`, `src/public/js/plugins/navbar.js`,
  compiled `src/public/css/style.css` (cache version bumped to 1.3.0).

---

# Round 10: admin panel, live settings, modals

## Admin panel (`/admin`)

- New layout: a sidebar with Overview, Live settings, Users, Tickets, Blog and Giveaways, and a "Live" dot that
  shows the panel is connected. The old placeholder sections (Data Graphs, Manage Stock, Items, Bots, Exchange)
  were empty and are gone.
- **Overview**: users online, trades in the last 24 h, items in stock, users, open tickets, key price, the status of
  the database, bot server and item server, the running giveaway, and a switch to pause trading. Refreshes every 15 s.
- **Live settings**: trading on/off, the announcement banner (text, color, live preview), item price limits, the item
  blacklist (with item search), your own app values, the apps that are connected and the recent changes. If another
  app changes something while you're on the page, it updates in front of you (and warns you if you were editing it).
- **Users**: search by SteamID64 or trade link, see trades, giveaways and who is online, and change the role.
  "Banned" (role 0) now really blocks creating trades.
- Tickets, Blog and Giveaways work as before, with the new look.

## Live settings for other apps

A socket.io namespace `/settings` on the website's server. Your apps connect with the same `SERVER_TOKEN` and
`SERVER_SECRET` as the bot and item servers, read the settings and change them; every change reaches the website,
the admin panel and every other app at once. The full guide with events and examples is in **`SETTINGS.md`**.

On the website:
- trading paused → new trades are refused and visitors get a notice without reloading
- blacklisted items → trades with them are refused
- announcement → a banner under the menu on every page, updated live

The settings are loaded once when the database connects and kept in memory, so no page waits on the database for them.

## Modals

- **Trade offer**: one clean card for every state, a colored status line and dot (purple while working, orange when
  prices changed, green when ready or accepted, grey when cancelled/declined/expired, red on error), a spinner or a
  status icon, the bot as a card, the 3-minute and "check your items" notes as callouts, and one big green "Open
  the trade offer" button.
- **Item search** (Ctrl+K): command-palette style. Matching words are bold, ↑/↓ moves through the results and Enter
  opens one; keyboard hints at the bottom.
- **Add / remove stacked items**: shows the item's picture and name and how many are available (or in the trade),
  − / + buttons, a slider, quick picks (1, half, Max), and Cancel / "Add 3×" (green) or "Remove 3×" (red). Enter confirms.
- All modals: blurred background, open animation, a round × button, close with Esc or by clicking outside, and they
  fit phones.

## Page animations

Kept small and quick:
- the page content fades in and rises 10px when a page opens (0.5 s)
- moving to another page cross-fades and the menu stays put (Chrome, Edge and Safari 18+; other browsers simply load
  the page as before)
- blocks further down a page fade in and rise 18px as you scroll to them, a few at a time
- smooth scrolling for in-page links
- the trade page and the admin panel stay still (they're tools, the motion would get in the way), and nothing moves at
  all for visitors whose system asks for reduced motion
- give any element `data-reveal` to add the scroll effect, or `data-no-reveal` to keep it still

## Files

- new: `src/service/settings.js`, `src/service/settings_socket.js`, `SETTINGS.md`, `src/public/js/motion.js`,
  `src/public/scss/partials/_motion.scss`,
  `src/public/scss/partials/_modals.scss`, `src/public/scss/partials/_announcement.scss`
- changed: `src/model/SiteSetting.js`, `src/service/socket.js`, `src/app.js`, `src/mw.js`, `src/fn.js`,
  `src/api/index.js`, `src/api/routes/admin.js`, `src/view/admin/admin.ejs`, `src/public/js/admin.js`,
  `src/view/partials/footer.ejs`, `src/view/partials/nav.ejs`, `src/view/partials/head.ejs`, `src/view/cookies.ejs`,
  `src/public/js/main.js`, `src/public/js/plugins/trade.js`, `src/public/scss/style.scss`,
  `src/public/scss/partials/views/_admin.scss`, `src/public/css/style.css` (compiled), `src/locales/*.json`
  (new texts in all 8 languages)
- `.env`: nothing required. Optional `SETTINGS_READ_TOKEN` for read-only apps.
- The `tf2deal_setting` cookie is no longer set.

---

# Round 9: killstreak tiers and the sell/buy view

## Killstreak tier select (item page)

Before, the select did nothing:
- its options showed raw tier numbers
- it had no `id`, so `main.js` never found it
- `main.js` read an older data shape (`item.killstreak.killstreaks` with `kt`)

Now picking a tier:
- shows its name ("Killstreak", "Specialized Killstreak", "Professional Killstreak") in the select, the title, the
  breadcrumb and the browser tab: "Professional Killstreak Rocket Launcher"
- shows that tier's **sell and buy prices** and its **stock** ("Can buy", "in stock"), and turns Sell / Buy on or off
  to match
- opens Sell / Buy with **only the copies of that tier**. "None" lists items without a killstreak, plus any tier that
  has no price of its own.

Prices come from `item.killstreak`, in the shape your model describes: `[{ ks_tier, buy, sell, stock }]`.
- `ks_tier`: 1, 2, 3 or the tier's name
- `buy` / `sell`: in ref, or `{ key, metal }`
- `stock`: `{ cur, limit }`

The older `{ killstreaks: [{ kt, … }] }` shape works too. If a tier has no price, the item's normal price is used, as
before. A link straight to `/items/Professional Killstreak …` opens with that tier picked.

## Sell / Buy view (signed in)

- **Layout:** one toolbar for the whole view.
  - left: the item's picture and name, and "Sell" or "Buy" with the price of one item
  - middle: Reload and Remove selected
  - right: the item count, the total and the Trade button
  - Everything uses the shared panels and buttons from Round 8, and stacks on phones.
- **Selected items** get a violet ring. Items with a killstreak show a small "KS / Spec. KS / Pro. KS" badge.
- **Prices:**
  - each copy is priced with its own tier's price, in the tiles, the tooltip, the total and the trade sent to the bot
    server
  - the tooltip shows the full name, e.g. "Professional Killstreak Rocket Launcher"
- **Messages:**
  - when you have no copies, the grid says so: "You don't have this item in your Steam inventory." / "Our bots don't
    have this item right now."
  - server errors are shown instead of a generic message

### Bugs fixed

- **Totals:**
  - "1 key 50 ref" was shown as "1 key 5 ref": the code cut the last zero off whole numbers too
  - a 0.05 ref item anywhere made all metal show 3 decimals
- **Stock limit:** "Can buy 2" only let you pick 1 item. The stock check was off by one.
- **Bot filter:** it was never filled in on this page and called a function that doesn't exist (`set_single_filter`).
  It's removed. You still can only buy from one bot per trade: items on other bots grey out after the first pick, as
  before.
- **"Remove selected"** looked enabled even with nothing selected.

## Files

- **JS:**
  - `public/js/plugins/trade.js`: tier helpers, per-copy prices, totals, stock check, messages
  - `public/js/main.js`: the select and the sell/buy header
- **Views and styles:**
  - `view/item_page.ejs`: the select, the toolbar header, the bot filter removed
  - `scss/partials/views/_items.scss`
  - `partials/head.ejs`: CSS version is `?v=1.1.8`
- **Locales:** `js.item.no_items_sell`, `js.item.no_items_buy`, `js.item.price_each` in all 8 files.

## How this was tested

A test weapon with three tier prices was used, with signed-in Sell and Buy on desktop and phone:
- every tier: name, price and stock in the overview, and the items in the sell/buy grid
- totals and the trade sent to the bot server
- English and Czech

The item, home, profile/tickets/giveaways and admin test suites pass with no page errors.

---

# Round 8: one consistent look

The pages each had their own colors and heading styles: grey boxes, black boxes, bright purple bars, orange labels
and white inputs. Now they share one set of colors, headings, panels, buttons and inputs. The colors are the
original ones: the navy background and nav bar, the logo purple, and the item quality colors. The winter cabin, the
color-in animation, the snow and the tree are unchanged.

## The shared look: `scss/helpers/_design.scss` (new)

- **Colors** as CSS variables:
  - text: `--ink`, `--ink-2`, `--ink-3`
  - surfaces: `--surface` (the nav bar's navy) for panels, `--surface-2` for rows inside a panel, `--tile` for item cards
  - borders: `--line`
  - actions: `--brand` (the logo purple), `--brand-muted` (the old secondary purple), `--green` (trade/buy)
  - links: `--violet`
- **Corners:** three sizes, `--r-sm` / `--r-md` / `--r-lg` (before: 3, 4.8, 5, 7, 8 and 10px).
- **Mixins** that every page uses instead of its own copy:
  - `page-title`: the page's h1 (Item Database, Blog, About Us, the item name, …)
  - `section-title`: the h2s (Latest trades, Price History, How to trade?, …)
  - `panel`: a content box
  - `button(primary | secondary | success)`
  - `input`
- **Heading font:** Rubik Bold, self-hosted in `public/font/`.
  - The browser only downloads the subset a page needs (Latin, Latin Extended for Czech, Cyrillic for Russian), 8–19 KB
    each. Chinese uses the system font.
  - It's free (SIL Open Font License, `public/font/rubik-OFL.txt`).
  - Body text keeps the system font. Sansation wasn't usable for headings: the file only has the Light weight and no
    Czech or Cyrillic letters.

## Home page

| Part | Before | Now |
|---|---|---|
| Hero | Thin grey headline, a big green button next to a small purple one | Bold headline, a pill that says if trading is online, two buttons of the same size |
| Stats | Four separate purple boxes | One strip with four columns: the number big, the label under it |
| Intro | The character in a mint box hugging the left edge, a purple heading box | The character (with the original glow) next to the text, a plain heading |
| Latest trades | A black box | A navy panel; the trade records use navy too (also on Profile → Trades) |
| Skins / Unusuals / Tools | Three wide black stripes, colors set inline | Three cards side by side (stacked on phones), each with a top border in its quality color |
| FAQ | A black heading box, a narrow purple list | An accordion panel next to the tree; the arrow turns when a question opens |
| Spacing | 10–18rem gaps between sections | 6rem. The phone page went from 6,300px to 4,200px tall |

- `home.ejs`: the cards' inline colors moved into classes (`promo-skins`, `promo-unusuals`, `promo-tools`).

## Every other page

- **Page titles:** the grey box with purple text is now the shared title (Items, Blog, About, Terms of Service,
  Giveaway, Support, the item page, blog posts).
- **Section headings:**
  - the bright purple bars on the item page, the purple boxes on About and Support, and the black FAQ box all use the
    shared section heading now
  - **Profile:** the profile header is a navy panel with tab buttons
- **Panels:** the black, grey and near-black boxes are navy panels. This covers:
  - the item page's image box, price history and info box
  - About's lists and bots table
  - the giveaway box and previous giveaways
  - the support form, the profile, blog cards, the cookie policy table, the search popup, the trade offer popup and
    the cookie banner
- **Item cards and inventory slots** (items page, item page, trade page, profile, giveaways) are navy instead of grey. The
  quality color line at the bottom stays.
- **Buttons:**
  - item page Buy/Sell, Enter giveaway, Submit ticket, New ticket, Load more and the 404 button use the three shared
    button styles
  - **Profile:** the yellow edit buttons are purple, and the save button is green
- **Profile:** orange labels are grey and the values are white, so the numbers stand out. "1 entered, 1 won" no longer
  wraps.
- **Support:** the light grey inputs with a monospace placeholder are dark inputs with a purple focus ring.
- **Notices:** the bright red "You are not signed in" bar is a calmer outlined bar at the content width. The About
  page's warning matches it.
- **Footer:**
  - the four link columns sit in one row ("Other" used to drop under "Technical"), and two by two on phones
  - the headings use the heading font
- **Admin panel:** the plain blue link list at the top is a row of tabs.

## Also fixed

- The support form's button said "Submit Ticket" in English in every language. It's translated now
  (`support.submit`, all 8 languages).
- `items.ejs`: the h1 had an inline `opacity: .8`. `404.ejs` / `error.ejs` had inline font sizes and colors.

## Files

- **New:**
  - `public/scss/helpers/_design.scss`
  - `public/font/rubik-700-*.woff2` (4 files)
  - `public/font/rubik-OFL.txt`
- **Changed SCSS:**
  - `style.scss`
  - `helpers/_trade_records.scss`
  - `partials/_navbar.scss`, `_footer.scss`
  - `views/_home.scss`, `_items.scss`, `_index.scss`, `_profile.scss`, `_giveaway.scss`, `_blog.scss`, `_about.scss`,
    `_bots.scss`, `_tos.scss`, `_ticket.scss`, `_cookies.scss`, `_admin.scss`
- **Changed views:**
  - `home.ejs`, `items.ejs`, `create_ticket.ejs`, `404.ejs`, `error.ejs`
  - `partials/head.ejs`: preloads the heading font; CSS version is `?v=1.1.7`
- **Locales:** `support.submit` in all 8 files.
- `css/style.css` is rebuilt.

## How this was tested

- Screenshots of every page before and after, on desktop (1440px) and a phone (390px), signed in and out. Nothing
  scrolls sideways.
- Checked in Russian, Czech and Chinese: the headings show the right letters, and Chinese falls back to the system
  font.
- The browser test suites from the earlier rounds all pass with no page errors:
  - home
  - item buy/sell
  - tickets, blog, giveaways, profile and admin
  - the language checks
  - the SEO checks

---

# Round 7: item names are never translated

Item names stay exactly as they are in every language, because that's how traders find items.

- **AI translation of posts and giveaway descriptions** (`service/translate.js`):
  - Before a text goes to the AI, every item name from your item database is replaced with a placeholder (`{{1}}`,
    `{{2}}`, …). The AI never sees the names, and they're put back exactly afterwards.
  - "Every item name" means both the full name with its quality, like "Strange Team Captain", and the base name. The
    list is cached for an hour.
  - The longest name wins: "Strange Team Captain" is one placeholder, not "Strange" plus "Team Captain".
  - Only whole words with the same capitalisation as in the database are matched, so ordinary words and partial
    words are left alone. Link and image addresses (`](…)`) are never touched.
  - If the AI's answer loses a placeholder, that translation is rejected: the page keeps the original, Admin → Blog
    shows the reason ("the translation lost the item name …"), and it's tried again automatically.
  - The instructions to the AI still say to keep other TF2 terms (qualities, effects, key/ref) in English, for
    anything that isn't in the item database.
- **Browser translation.** Item names on the site are marked `translate="no"`, so Chrome's built-in "Translate this
  page" (and similar tools) leave them alone too. That covers the item page heading and similar items, item cards,
  tooltips, search suggestions, giveaway prizes and past winners, the wishlist, and profile giveaways.
- **Chinese labels.** "Strange Part", "Strange Filter" and "Strange Parts:" now keep "Strange" in Chinese, as they
  already did in the other languages.
- **Not changed.** Item category labels ("Cosmetic", "Taunt", …) and class names are still translated. They describe
  items rather than name them. Say if you'd rather keep those in English too.

**How this was tested:**
- **The masking on its own:** longest match, link addresses, lower-case, plural and partial words not touched,
  repeated names, putting names back, and a lost placeholder being rejected.
- **In the running app with the free provider:**
  - A post mentioning Team Captain, Strange Team Captain, Bill's Hat and Earbuds reached the AI only as `{{1}}`–`{{4}}`.
  - The translations came back with the exact names.
  - A test translator that dropped a placeholder in Chinese was rejected with the reason shown.
- **All earlier browser tests still pass.**

---

# Round 6: a free translator

## Free translators, compared

What each free option offers as of October 2026, from the services' own pages:

| Service | Free allowance | Catch |
|---|---|---|
| **Cloudflare Workers AI** (now built in) | 10,000 "neurons" a day: about 10 average posts a day | Translation stops for the day when the allowance is used up, and resumes after 00:00 UTC. Good open AI models, a step below Claude or DeepL. |
| DeepL API Free | 500,000 characters a month | Not an AI model, so keeping the Markdown intact needs extra work. Needs a DeepL account. |
| Azure AI Translator (F0) | 2 million characters a month | Needs an Azure account. |
| Google Cloud Translation | 500,000 characters a month (as a $10 monthly credit) | Needs a Google Cloud billing account. |
| MyMemory | 5,000 characters a day, or 50,000 with an email address | Quality varies (it mixes in a shared translation memory). |
| Gemini API free tier | | Google's terms allow only paid use when serving users in the EEA, Switzerland or the UK, so it can't be used for tf2deal.com. |
| LibreTranslate | Unlimited (you host it) | Runs on your own server and needs memory for the models. Lower quality. |

## Why Cloudflare Workers AI

- **It costs nothing.** On Cloudflare's free plan, requests simply fail once the daily allowance is used up; nothing is
  billed. No credit card is needed.
- **It's an AI model**, so it handles Markdown and TF2 terms the same way as the Claude option. The two share the same
  code.
- **Your site already runs on Cloudflare**, so it's the same account.
- **Your posts stay yours.** Cloudflare doesn't use your content to train models.
- **It's allowed in the EU** (unlike Gemini's free tier).

**Default model:** `@cf/google/gemma-3-12b-it`.
- It's built for 140+ languages (Czech, Russian and Chinese included), with an 80,000-token context.
- An average post (about 800 words) into 7 languages takes roughly 900 neurons, so about 11 posts a day fit in the free
  allowance.
- A stronger option: `TRANSLATE_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast`. It uses about 2,400 neurons per post,
  so about 4 posts a day.

**Setting it up:**

1. In the Cloudflare dashboard, open **Workers AI** and choose **Use REST API**.
2. Choose **Create a Workers AI API Token**, then **Create API Token**, and copy the token. Copy the **Account ID** from
   the same page.
3. Add both to `src/config/.env`:
   ```
   CLOUDFLARE_ACCOUNT_ID=...
   CLOUDFLARE_AI_TOKEN=...
   ```
4. Restart. The log says `translate: AI translation is on (Cloudflare Workers AI, @cf/google/gemma-3-12b-it)`, and Admin
   → Blog shows the translator in use.

**Claude still works.** If both are set, Cloudflare is used unless you add `TRANSLATE_PROVIDER=claude`.

## Other changes to the translator

- **When the daily allowance runs out**, the remaining languages are marked as failed in Admin → Blog (hover for the
  reason). Every failed language is retried automatically each hour, so they fill in after the reset at 00:00 UTC
  (2:00 in Prague in summer).
- **Long posts are split** into pieces (about 4,000 characters for Cloudflare, 12,000 for Claude) and joined back in
  order, so a long post fits within the model's limits.
- **The text goes to the model in marked sections** (`<<<title>>>`, `<<<content>>>`) instead of JSON. Smaller models
  often produce broken JSON when a post contains quotes or line breaks.
- **Fixed: `TRANSLATE_MODEL` in `.env` was ignored.** The Round 5 code read it before `app.js` loads `.env`. All
  translation settings are now read when they're used.

## How this was tested

- **Directly against the service code**, with every setting applied after the module loaded (as your `.env` is):
  - Cloudflare's answer format, and an answer wrapped in a code block
  - the "daily free allocation used up" error: fails at once, without retries
  - a 12,000-character post split into 4 pieces and joined back in order
  - `TRANSLATE_MODEL`, switching to Claude (with its "overloaded" retry), and a half-configured provider counting as off
- **In the running app with the free provider:**
  - Russian hit the daily limit and showed "6/7, 1 failed" with Cloudflare's message.
  - On the next sweep it was filled in.
  - The full browser test passed: a Czech post translated into all languages, show original, editing and
    re-translation, *Translate again*, the giveaway description, and a `<script>` in a translation shown as text.
- **All earlier browser tests still pass.**
- **Not tested: Cloudflare's real API.** There's no account here, and the network is blocked. After you add the two
  values, publish a test post and open it in a couple of languages.

---


# Round 5: automatic language and AI translation

## The site picks the visitor's language, the visitor decides

- **First visit.** When someone arrives from outside (a search result, a bookmark, a link) on a plain English URL,
  the site looks at their browser's language. If it's one of the 8, the page opens in it: a Czech browser gets
  `/cs/…`. English browsers, and languages the site doesn't have, stay in English.
- **The visitor decides:**
  - Picking a language in the menu, or "Switch to …" in the suggestion bar, saves it (`td_lang`, 1 year). From then on
    the site opens in that language, also on the plain URLs.
  - Picking English is remembered too, and stops the automatic switch.
  - Closing the suggestion bar keeps the page's language and saves that. The bar appears when someone opens a link in
    another language than their browser's, for example a Czech visitor on `/de/items`.
- **What is never redirected:**
  - Clicks inside the site. Only arrivals from outside are detected, so anyone can browse the English pages.
  - Links that already contain a language (`/de/…`). They open as they are.
  - Search engines and link-preview bots (Googlebot, Bingbot, Discord, …). They always get the page they asked for,
    so English stays indexed at the plain URLs.
- **Search engines.** Google advises against language redirects mostly because crawlers can be sent away from a page;
  excluding the bots avoids that, and the `hreflang` links still connect the versions.
- **Caches.** Plain-URL pages send `Vary: Accept-Language, Cookie`.

## Cookies: the language cookie no longer needs consent

- **Why.** `td_lang` is now only written when the visitor picks a language themselves. EU guidance treats that kind of
  user-interface cookie as exempt from consent, and names language cookies set by clicking a flag as the example
  (Article 29 Working Party, Opinion 04/2012, section 3.6). That's what lets the choice be saved for everyone, as you
  asked.
- **The banner is now a notice.** The language cookie was the only optional one, so there was nothing left to accept
  or reject.
  - The banner reads "TF2Deal.com only uses necessary cookies: … Read our cookie policy." with an *OK* button.
  - *Cookie settings* shows *Necessary: always on* and says there are no optional cookies.
- **With analytics.** When you turn on analytics (`app.locals.analytics_enabled = true`), the banner automatically
  goes back to *Accept all* / *Reject optional* / *Settings*, with an Analytics switch.
- **Cookie Policy page.** `td_lang` is now listed under necessary cookies, and a new section, "Your language",
  explains the detection and the saved choice.

## AI translation of blog posts and giveaway descriptions

- **What's translated.** Blog posts (title, short description, text) and the giveaway description, into every other
  site language. You can write in any of the 8 languages: "Written in" in the editor and the giveaway form. A post
  written in Czech is translated into English too.
- **When.** In the background when you publish or edit a post, one language after another. That's roughly 10–60
  seconds per language, depending on length.
  - Until a translation is ready, the page shows the original.
  - Editing a post translates it again. Until that's done the page shows the original, never an outdated
    translation: each translation stores a fingerprint of the text it was made from.
- **What visitors see:**
  - The post in their language, with a note: "Translated automatically by AI. Show original (Čeština)".
  - *Show original* shows the original on the same page, with a link back to the translation.
  - Giveaway descriptions get a small "Translated automatically by AI" line.
- **Admin → Blog:**
  - A *Translations* column: 7/7 ✓, "translating…", or "failed" (hover for the reason).
  - A *Translate again* button.
  - In the editor, a ✓ per language that links to each translation.
  - Drafts aren't translated.
- **SEO:**
  - Each translated post has its own URL (`/de/blog/<post>`) and canonical.
  - `hreflang` links connect only the languages the post really exists in; a language without a translation points
    to the original.
  - Translated versions are listed in `sitemap_blog.txt`.
- **Safety.** Translated text goes through the same Markdown renderer as your posts, which escapes all HTML, so a
  translation can't inject a script. I tested this with a test translator that returned a `<script>` tag.
- **What the model is told:**
  - Keep the Markdown and the link targets.
  - Keep TF2 item names, qualities, effects and key/ref/rec/scrap as they are.
  - Address readers the same way the site does in each language.
- **If something fails:**
  - It retries on its own when the API is busy (429/529) or briefly unreachable.
  - A language that still fails is shown in the admin panel. It's tried again on the next edit, *Translate again* or
    restart.
  - On start, anything published but not yet translated is translated, for example posts written before you added the
    key.
- **Not translated:** support tickets (messages between users and you), item names, and the legal pages.

**Turning it on:** *(Round 6 adds a free option, Cloudflare Workers AI; the steps below are for Claude.)*

1. Create an API key in the Claude Console (platform.claude.com). It needs billing set up.
2. Add it to `src/config/.env`: `ANTHROPIC_API_KEY=sk-ant-...`
3. Optionally set the model with `TRANSLATE_MODEL`. The default is `claude-sonnet-5-5`; `claude-haiku-4-5-20251001` is
   cheaper and faster, and `claude-opus-5-5` is the strongest.
4. Restart. The log says `translate: AI translation is on (claude-sonnet-5-5)`.

Without a key the feature is off: posts show as written, with "This post is only available in its original
language".

**Cost.** Sonnet 5.5 is $2 per million input tokens and $10 per million output tokens. Translating a typical
800-word post into 7 languages is roughly 10–11 thousand tokens each way: about $0.10–0.20 per post, paid only when
you publish or edit.

**Privacy.** The text of your posts and giveaway descriptions is sent to Anthropic's API to be translated. That's
only content you write in the admin panel, never visitor data.

## How this was tested

- **Language detection**, with real browser identities:
  - A Czech browser goes to `/cs`.
  - Picking English is saved, and kept on the next visit.
  - On a German link, Czech is offered, and both switching and closing the bar save the choice.
  - Clicks inside the site aren't redirected.
  - Googlebot with a Czech browser language gets English and no bar.
  - German and English browsers get nothing extra.
- **Cookie notice.** *OK* is saved and not shown again; the settings show no optional cookies; the Accept/Reject
  banner renders when analytics is on.
- **AI translation**, against a stand-in for the Claude API (same request and response format, checks the API
  headers):
  - a Czech post translated into the 7 other languages, English included
  - the admin status, show original and back, the blog list
  - editing a post, then *Translate again*
  - a giveaway description
  - an "overloaded" answer retried
  - a `<script>` in a translation shown as text
  - the sitemap, no API calls on restart, and the "no API key" mode
- **All earlier browser tests still pass.**
- **Not tested: the real Claude API.** There's no key here and the network is blocked. After you add the key, open a
  post in a couple of languages to check the first real translations.

---


# Round 4: languages and cookies

## Real multilanguage support

**Before:**
- Every page carried all 7 translations of a few headings in its HTML, and a script hid all but one. Search engines
  saw one page in mixed languages.
- Everything else (buttons, messages, toasts, page titles) stayed in English.
- The choice lived only in the browser.

**Now:**

- **One address per language.** Every page exists in 8 languages:
  - English keeps the plain URLs (`/items`).
  - The others get a prefix: `/cs/items`, `/de/…`, `/es/…`, `/fr/…`, `/pt/…`, `/ru/…`, `/zh/…`.
  - `/en/…` redirects to the plain URL.
- **Everything is translated:**
  - page text, the menu and footer, buttons, form placeholders and tooltips
  - page titles and descriptions
  - messages from the server ("saved", errors, giveaway requirements)
  - toasts and everything the scripts build (trade page, item page, profile tabs, tickets)
- **The language menu** in the nav lists every language by its own name. Each entry links to the current page in that
  language.
- **Language suggestion.** If the visitor's browser is set to one of these languages, a small bar in that language
  offers it ("Tato stránka je dostupná i v češtině. Zobrazit česky"). There's no automatic redirect, so search engines
  and anyone who wants English always get English at the plain URL. Closing the bar hides it for the session.
  *(Changed in Round 5: first visits now open in the browser's language.)*
- **Remembering the language.** The choice is saved (cookie `td_lang`, 1 year) only if the visitor allows preference
  cookies. Opening tf2deal.com then takes them straight to their language. Without consent the language still works,
  because it's part of the URL. *(Changed in Round 5: a language the visitor picks is saved without asking.)*
- **Login keeps the language.** After signing in with Steam you come back to the same page in the same language.
- **SEO:**
  - `<html lang>` per page
  - `hreflang` links between all language versions, plus `x-default`
  - a canonical URL per language, and `og:locale`
  - per-language item sitemaps (`sitemap_de_1.txt`, …), and the main pages of every language in `sitemaps/index.txt`
  - `robots.txt` also blocks the language versions of the profile, support and trade-offer pages
- **Kept in English on purpose:**
  - Item names, qualities and class names, as they're used in TF2 trading.
  - Blog posts. They're shown in the language they were written in, and their canonical stays the English URL.
    *(Changed in Round 5: posts are translated by AI.)*
  - The Terms of Service and Cookie Policy. Other languages show a note that the document is in English, because a
    machine translation of a legal text shouldn't be the binding version.
  - The admin panel.

**How it works:**

- **Where the texts live.** Each language is a file, `src/locales/<lang>.json`, with 533 texts.
  - `en.json` is the source. A text missing in another language falls back to English, so a page never shows a raw
    key.
  - A key that doesn't exist at all is logged once by the server as `i18n: missing key "…"`.
- **Using them:**

  | Where | How |
  |---|---|
  | Views | `<%= __('nav.trade') %>`, and links as `<a href="<%= lurl('/items') %>">` |
  | Routes | `req.__('title.items')`, `req.lurl('/blog')` |
  | Browser scripts | `__('trade.max_items')` (the texts under `"js"` in the locale files), `lurl('/items/…')` |
- **Adding a language:**
  1. Add its code to `LANGS` (and the name and tag lists) in `src/i18n.js`.
  2. Copy `en.json` to `<code>.json` and translate it.
  3. Add a flag image.
  4. Add its lines to `robots.txt`.
- **About the translations.** I wrote them (AI translation). They're checked mechanically: every text exists in every
  language, with the same `{placeholders}` and HTML. Still, have a native speaker read the pages that matter most to
  you before relying on them.

## Cookie policy and consent

- **Cookie Policy page** (`/cookies`, linked in the footer).
  - It lists every cookie and browser-storage item the site really uses, what it's for and how long it stays. I checked
    each one against the code.
  - It also covers Cloudflare's cookies and Steam (login and images).
- **Banner on the first visit:** *Accept all* / *Reject optional* / *Settings*, with equal weight. EU rules expect
  rejecting to be as easy as accepting. The banner is translated and fits on phones.
- **Settings dialog:**
  - *Necessary* is always on.
  - *Preferences* (remember the language) is a switch.
  - An *Analytics* switch is built in but hidden until you add analytics. Set `app.locals.analytics_enabled = true`;
    the top of `public/js/consent.js` explains how to add a script that only runs after consent.
- **Storing and changing the choice:**
  - The choice is saved in `td_consent` for 12 months, then the banner asks again.
  - A *Cookie settings* link in the footer of every page (and on the policy page) reopens the dialog.
  - Withdrawing consent deletes `td_lang` immediately.
- **The server respects the choice.** `td_lang` is never set without preference consent.
- *(Changed in Round 5: `td_lang` is no longer optional, so the banner is a notice with OK until optional cookies
  exist.)*

## Fixed along the way

- `style.css` is rebuilt, and its version is bumped to `?v=1.1.5`.

- **Cookie lifetimes.** `maxAge: Date.now(2147483647 * 1000)` in `mw.js` and `fn.js`: `Date.now()` ignores its
  argument, so `td_<steamid>`, `tf2deal_setting` and `td_current_url` were set to live about 56 years. They're now 1
  year (`td_current_url`: 1 day), matching the cookie policy.
- **Return-to-page cookie.** `td_current_url` now keeps the language prefix, which is how login returns you to the
  page in your language.

## Please check before going live

- **The cookie policy is a template written from what the code does. I'm not a lawyer.** Check it fits your
  situation. Under the GDPR the site should also give the operator's identity and a way to contact them, such as an
  email address. The policy names you (as in the footer) and points to the Support page; add your details if needed.
- **There's no privacy policy yet.** The account data you keep (Steam ID, trade URL, email, trades, tickets) usually
  calls for one; that's a separate document.
- **If you add analytics or ads later**, load them through the consent hooks and update the policy first.

## How this was tested

- **Every page in all 8 languages** returns the right status (200s, 404s, the `/en` redirect).
- **German vs English.** I compared the visible text of 15 pages, including text built by scripts and placeholders,
  tooltips and labels.
- **All 8 languages** showed no raw keys, no unfilled placeholders, no script errors and no missing-key warnings.
- **The flows:**
  - the language menu, and the suggestion bar in a Czech browser
  - consent accept, reject, settings and withdraw
  - the language being remembered with consent, and not without it
  - login returning to the same language
  - server messages and toasts in German and French
  - `hreflang`, canonical and `og:locale`
  - the sitemaps, and the phone layout
- **All earlier browser tests still pass:** item buy/sell payloads, home stacking, tickets, blog, giveaways and
  profile.

---

# Round 3: SEO

## Fixed: these were hurting your search ranking

| Problem | Fix |
|---|---|
| **Canonical URLs were wrong on almost every page.** `head.ejs` built them from the page *title*, so the Items page told Google its real address was `https://www.tf2deal.com/tf2deal.com - items`. Only the home page was right. Google treats the canonical as "the real URL of this page", so it was pointed at addresses that don't exist. | Each page's canonical is now its own address, without a query string or trailing slash. For example `https://tf2deal.com/items/Team%20Captain`, the same form as in the sitemap. |
| **Two domains.** Canonicals used `www.tf2deal.com`; the sitemap, robots.txt and structured data used `tf2deal.com`. | Everything uses `https://tf2deal.com`. It's one constant, `site_url` in `fn.js` (plus the `Sitemap:` line in robots.txt), if the live site should be `www`. |
| **Every item page had the same description and a bare title** ("Team Captain"). Thousands of pages with identical descriptions look like duplicates. | Title: `Team Captain - Price & Trade \| TF2Deal.com`. Description, built from the item's real prices and stock: "Buy Team Captain for 2 keys 0.11 ref or sell it for 1 key 50 ref on TF2Deal.com. 3 in stock, instant automated trades." |
| **No `<h1>` on the item page** (the name was a `<div>`) or on the trade page. | The item name is now the `<h1>`, with the same look. The trade page has a visually hidden `<h1>Trade TF2 items</h1>`. |
| **Image alt texts were a file path** (`/public/img/group-icon.png`) or `item_img`. | The alt is the item name on the item page, similar items and the items list. |
| **The main item image was lazy-loaded.** It's the largest thing on the page, so it loaded last, which hurts Google's page-speed score (LCP). | It loads immediately with `fetchpriority="high"`. Similar-item images are lazy-loaded instead. |
| **The structured-data search URL** pointed to `/items/440/<search>`, which is a 404. | It points to `/items?name=<search>`. |
| **`/updates` answered with an error page** (there is no `updates` view). | It redirects (301) to `/blog`. |
| **Title and description weren't escaped** (`<%-`). A `"` in an item name or blog title broke the tag. | Escaped (`<%=`). |
| **Links in blog posts to your own pages** had `rel="nofollow"` and opened in a new tab, so search engines didn't follow them. | Links to your own pages are normal links. External links still open in a new tab. |

## Added

- **Descriptions** for Trade, Items (the same text logged in or out; Google sees the logged-out page), Giveaway (names
  the current prize), About and Terms. A blog post uses its excerpt, or the start of the post if it has none.
- **Link previews** (Open Graph + Twitter tags). Links shared on Discord, Steam chat, X or Facebook show the title,
  description and an image:
  - item pages show the item image
  - blog posts show their cover
  - other pages show the new `img/og-image.png` (1200×630, made from your logo)
- **Structured data**:
  - breadcrumbs on item pages (Home › Items › item name), which Google can show in results
  - `BlogPosting` on blog posts
- **`noindex`** on pages that shouldn't be in search results: profile, admin, login, support, `/buy/…` trade-offer
  links, blog drafts and the "coming soon" `/posts` page.
- **robots.txt** keeps crawlers away from the login-only and admin URLs (they only redirect a crawler to the Steam
  login). `/api` stays open because the items and home pages load their content from it.
- **Sitemap**:
  - Published blog posts are listed (`sitemaps/sitemap_blog.txt`).
  - Old numbered item sitemaps from a run that had more items are deleted, instead of staying listed with outdated
    URLs.
- **Titles**: "Giveaway 🎁" and "Posts" now include TF2Deal.com.
- `style.css` is rebuilt, and its version is bumped to `?v=1.1.4`.

## After you deploy

- Add the site to **Google Search Console** and **Bing Webmaster Tools** (your `msvalidate` tag is already there),
  then submit `https://tf2deal.com/sitemap.xml`. Search Console also shows which pages are indexed and why others
  aren't.
- Make sure `http://` and `www.tf2deal.com` redirect (301) to `https://tf2deal.com`, for example with a Cloudflare
  redirect rule.
- When I checked on 2 October, tf2deal.com answered with Cloudflare **error 530** (Cloudflare couldn't reach your
  server). Google can't crawl the site while it's down, and a long outage makes it drop pages from the index.

## Not changed, but worth knowing

- **The home page `<h1>` contains all 7 translations.** Your language switcher keeps every translation in the HTML of
  the same URL, so search engines see one page in mixed languages. The proper fix is separate URLs per language
  (`/de/`, `/fr/`, …) with `hreflang` tags. *(Done in Round 4.)*
- **The items list is built with JavaScript.** The item cards are real `<a href>` links, so Google can follow them, and
  every item is in the sitemap anyway.
- **The `keywords` meta tag is ignored by Google.** It's harmless, so I left it.

## How this was tested

- I checked the HTML the server sends for every page type: title, description, canonical, `robots`, Open Graph and
  `<h1>`, and that the JSON-LD parses.
- That included 404s, trailing slashes, query strings, drafts (admin vs guest), robots.txt and the generated sitemap.
- I re-ran all the earlier browser tests (item buy/sell, home stacking, tickets, blog, giveaways, profile), and they
  pass.

---

# Round 2: unfinished pages

## Item page: Buy / Sell now creates the trade

The item page now sends the trade the same way the trade page does: the same `User`/`Site` payload to
`/api/create_trade`, paid in keys and metal at the item's price.

- **Setup.** The route (`routes/router.js`) refreshes the trade hash and passes `key_price`, like the trade page.
  Without this, the API would reject the request.
- **One bot per trade.** Once you pick an item from one bot, items on the other bots are greyed out, and clicking one
  shows a message.
- **Buttons.**
  - The Trade button shows creating → confirmed / denied, and clears the selection after a successful offer.
  - "Remove selected" and "Reload inventory" now work.
- **Small fixes on the way:**
  - Removed a leftover `alert(steamid)` in `setBot`.
  - The item tooltip no longer crashes on items without attributes (`Item?.at?.hasOwnProperty`).
  - Fixed the `#sell_item` hash check.
  - Removed a dead `ping_bots` fetch.

## Home page: latest trades are stacked

Identical items are shown once with a `×N` badge, using the same stacking as the trade page (`stack_sig` /
`group_assets`). An item with a killstreak, effect, etc. still gets its own tile.

The rendering moved from `main.js` into `public/js/plugins/trades_render.js`, so Profile → Trades uses exactly the same
markup. The trade record styles moved from `_home.scss` to `helpers/_trade_records.scss` as a placeholder
(`%trade-records`) that both pages `@extend`, so the CSS isn't duplicated.

## Support tickets (site inbox)

- **Creating a ticket.** `/support` saves the ticket to MongoDB (new `tickets` collection).
  - Limits: 3 open tickets per user, 5 new tickets per hour, 2000 characters per message.
  - "Brief details" stays optional. Without it, the topic becomes the first message.
- **Profile → Tickets.** The user sees each conversation, can reply and can close a ticket.
- **Admin → Tickets.** Filter by Open / Answered / Closed / All, then reply or close.
- **Status.**
  - It moves to *answered* when you reply.
  - It goes back to *open* when the user replies.
  - A *closed* ticket can't be replied to.

## Blog

- **Admin → Blog.** Create, edit and delete posts, with draft / published and a Preview button. The URL slug is made
  from the title.
- **Post format.** Posts use simple markdown:
  - `#`, `##`, `###` headings
  - `**bold**`, `*italic*` and `` `code` ``
  - `[link](url)` and `![image](url)`
  - `-` lists and `>` quotes

  All HTML is escaped, so a post can't inject scripts.
- **Public pages.** `/blog` lists published posts, 12 per page. `/blog/<slug>` shows one post. Drafts are visible only
  to the admin account (they're marked as drafts).
- **Model.** `model/Blog.js` used `require()`/`module.exports`, so it couldn't be imported in this ES-module app. It's
  now an ES module with `slug`, `excerpt`, `cover` and `published` added. Old documents in `blogs` without a slug or
  published flag won't show until you re-save them.

## Giveaways (admin panel, manual prize)

- **Admin → Giveaways: start one.**
  - Fields: item (exact name from your item database; image and quality are taken from it), end date, optional
    description.
  - Requirements: "member of our Steam group" and "1 trade on the site since the giveaway started".
  - Only one giveaway can be active at a time. It can be ended early ("End now") or cancelled.
- **`/giveaway` page.**
  - Shows the item, a countdown, the number of entries and the requirements.
  - After the user clicks *Enter giveaway*, each requirement shows ✓ or ✕ with a message saying what's missing.
  - Shows past giveaways with their winners.
- **Drawing the winner.**
  - The winner is drawn automatically when the end time passes. It's checked in your existing 1-minute interval in
    `app.js`, with a secure random pick (`crypto.randomInt`).
  - You send the prize yourself. The admin table shows the winner with a "Send trade offer" link (their saved trade
    URL), then you tick **Prize sent**.
- **User side.**
  - Profile → Giveaways lists the user's entries and wins, and whether the prize was sent.
  - The user's existing `giveaways.entries` / `giveaways.won` counters are updated.
- **Steam group check.** It uses the Steam Web API (`GetUserGroupList`) with `API_KEY_STEAM` and `STEAM_GROUP_ID`.
  Steam can't read the groups of a private profile, so the user is told to make it public.
- **Files.** `model/Giveaway.js` was empty; it now has the schema. The logic is in the new `service/giveaway.js`.

## Profile

- **Overview.** Stats for trades, wishlist, giveaways (entered / won) and open tickets, each linking to its tab. The
  email field now saves (the same edit / save button as the trade URL).
- **Trades.** Your trades, 10 per page with "Load more", stacked like the home page.
- **Wishlist.** Cards with stock and price, plus a remove button.
- **Giveaways and Tickets.** As described above.

All of these load from new endpoints in `api/routes/user.js`:

| Endpoint | Use |
|---|---|
| `GET /trades` | Profile → Trades |
| `GET /wishlist` | Profile → Wishlist |
| `GET /giveaways` | Profile → Giveaways |
| `POST /giveaway/enter` | Enter the current giveaway |
| `GET /tickets`, `POST /tickets` | List or create tickets |
| `POST /tickets/:id/reply`, `POST /tickets/:id/close` | Reply to or close a ticket |

## Admin panel

- **New sections.** Tickets, Blog and Giveaways are in the admin page menu. The page script is
  `public/js/admin.js` and the API is `api/routes/admin.js` (`/api/admin/*`).
- **Access.** Same as your admin page: the `ADMIN_STEAMID` account after logging in at `/login` with `ADMIN_PASSWORD`.
  Everyone else gets `511`.
- **Bug fix: the menu never worked.** `head.ejs` already declares a global `const bots`, and `admin.ejs` declared
  `const bots` again. The browser stopped the whole admin script ("Identifier 'bots' has already been declared"), so
  clicking menu items did nothing. The unused `bots` in `admin.ejs` is removed.

## New files

| File | What it is |
|---|---|
| `model/Ticket.js` | Ticket schema |
| `service/giveaway.js` | Requirement checks and winner draw |
| `api/routes/admin.js` | Admin API for tickets, blog and giveaways |
| `public/js/admin.js` | Admin panel sections |
| `public/js/plugins/profile.js` | Loads the profile tabs |
| `public/js/plugins/trades_render.js` | Shared trade record markup (home + profile) |
| `view/profile/tickets.ejs` | Profile → Tickets |
| `scss/helpers/_trade_records.scss` | Shared trade record styles |
| `scss/partials/views/_blog.scss` | Blog styles |

`fn.js` gained small helpers: `escape_html`, `safe_url`, `render_markdown` and `slugify`. `style.css` is rebuilt, and
its version is bumped to `?v=1.1.3`.

## How this was tested

I ran the app against a local test database, a mock bot/item server and a fake Steam login, and clicked through every
flow in a headless browser:

- **Item page.** Buy and sell, checking the exact `/api/create_trade` payload. Also checked the one-bot rule, remove,
  and reload.
- **Home page.** Stacking.
- **Tickets.** Create, reply, admin reply and close.
- **Blog.** Draft vs published, preview, and HTML escaping.
- **Giveaways.** Create, requirements failing then passing, double entry, draw, prize sent, and cancel.
- **Profile.** Every tab, including pagination, wishlist removal and email saving.
- **Access control.** Guests and non-admins are refused.

Not tested against real Steam: the Steam group lookup and real trade offers.

---

# Round 1: fixes

## Bugs

| Where | What was wrong | Fix |
|---|---|---|
| `api/routes/user.js` (4×) | `res.cookie(name, value, value)` passed the cookie *value* as the options, so after saving a trade URL, email or wishlist the `td_<steamid>` cookie lost `httpOnly`, `secure` and `maxAge`. It became a session cookie that disappears when the browser closes. | `res.cookie(name, value, setting)` |
| `api/index.js` `/create_trade` | If the bot server was unreachable, the request never got a response. | Answers with a 500 error. |
| `api/routes/items.js` `POST /:bp_sku` | Never sent a response. | Answers `501` (not implemented yet). |
| `routes/router.js` `/buy/<not a number>` | Never sent a response. | Falls through to the 404 page. |
| `routes/router.js` item page | An unknown item crashed (`main.bp_sku` of null) and showed "We couldn't contact our database". | Shows the 404 page. |
| `mw.js` `curPath` | Missing `return`s. A trailing block could send a second response and rendered a `cookie_enabler` view that doesn't exist. It also logged the user's cookie on every request. | Added the returns and removed the block and the log. |
| `app.js` `/logout` | `next` wasn't defined. | Added the parameter. |
| `app.js` `/get_userDB_` | A missing `td_current_url` redirected to `/undefined?new_user=true`. A failed `save()` left the request hanging (try/catch doesn't catch a rejected promise). | Fixed both. |
| `app.js` DB connect | Logged "connected to DB" and ran the setup even when the connection failed. | Checks the error first. |
| `app.js` timeouts | `connect-timeout` and your own 60 s `res.setTimeout` both fired, so the response could be sent twice. | Kept yours and added a `headersSent` check. |
| `app.js` error handlers | The XHR handler came second, so it never ran. Error pages were sent with status 200. | Merged them into one handler that returns status 500. |
| `app.js` `/get-steambots` | Checked `Bot_Server.status`, which is never set, so it always answered "error". | Uses `bot_socket.socket`. |
| `app.js` `update_items()` | Used `require()`, which doesn't exist in ES modules, so it always failed silently. | Removed. |
| `app.js` `findMatchingMarketItems()` | `marketItems` was never declared (crashes in an ES module), and the steamapis key was hard-coded. | `const` + `process.env.API_KEY_STEAM_APIS` |
| `app.js` body parsers | Each body parser was registered twice and urlencoded three times. Only the first ones did anything. | Removed the duplicates. |
| `model/Item.js`, `model/Trade.js` | `createIndexes({ bp_sku: 1 })` only builds indexes declared in the schema, so it built nothing. | Declared the indexes in the schemas. |
| `fn.js` sitemap | `sitemap.xml` pointed to `/items//index.txt`. Every run also loaded whole item documents (stock, price history…) when it only needed `bp_sku`. | Correct URL; it now loads only `bp_sku`. |
| `scss/style.scss` | Font path `/fonts/` (the folder is `/font/`). | Fixed. |
| `public/js/main.js` | Reopening the search and typing the same text showed the placeholder instead of results. | Resets `lastSearch` when the search opens. |

## Loading / efficiency

- `head.ejs`
  - Removed the 4 `<link>`s that had two `rel` attributes (`rel="nofollow" … rel="stylesheet"`): Roboto, Caveat,
    hamburgers.css and Bootstrap CSS. Browsers downloaded them on every page but never applied them, so nothing changes
    visually.
  - Removed Bootstrap 5 JS and Bootstrap 3 JS. Nothing uses them, and v3 was loaded on top of v5.
  - Removed the second `socket.io.js` (it was loaded twice) and the Trustpilot widget script. The widget is commented
    out in `home.ejs`; add the script back if you re-enable it.
- `item_page.ejs`: removed Chart.js. It was loaded on every item page but never used.
- `home.ejs`
  - The hero image (the first thing on the page) is no longer `loading="lazy"`.
  - `sfm404_2.png` (1 MB) → `sfm404_2.webp` (38 KB), `sfm_tree.png` (129 KB) → `sfm_tree.webp` (34 KB). Same images,
    and the PNGs are still in the folder.
- `app.js`: gzip `compression()` (style.css now goes over the wire as about 39 KB).
- CSS is compiled minified: the `dev` script uses `--style=compressed`.
- `routes/admin.js`: removed the unused `puppeteer` import. It slowed every start.

## package.json

- Added `compression`. Removed `puppeteer` (unused, a very large install) and `connect-timeout` (replaced, see above).
  `package-lock.json` is updated to match.

## Two optional `.env` values

- `SESSION_SECRET`: the session secret was hard-coded as `thisisasecret`. That is still the fallback, but set a real
  one.
- `SITE_URL`: the Steam login return URL was hard-coded to `http://localhost:8080`. Set `SITE_URL=https://tf2deal.com`
  on the server.

## Not changed, but worth knowing

- `cors` origins end with `/` (`https://tf2deal.com/`). Browsers send the Origin without it, so these never match.
- `logRateLimit()` is never called, so the "5 rate limits → blocked" check in `checkAccess` never triggers.
- Many packages in `package.json` aren't used by this app (steam-user, steamcommunity, request, redis, csurf, apicache,
  sitemap-generator, plus the placeholder `dns`/`http`/`path`/`util` packages).
- The `/api/items` client token and secret are in the browser JS, so they aren't secret.
- The admin page's top menu (Data Graphs, Manage Stock, …) was unstyled plain links (styled as tabs in Round 8).
