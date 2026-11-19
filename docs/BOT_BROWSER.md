# Chrome or Edge window as a bot

Admin → Bot manager → Bots → **Open in Chrome** (in Edge: **Open in Edge**) opens a private window that is really
logged in as that bot: an incognito window in Chrome, an InPrivate window in Edge. It opens two tabs: the bot's Steam
profile, and backpack.tf already signed in through Steam. You can browse Steam, the store and backpack.tf as the bot,
like on its own PC.

It needs the small extension in `extension/`, the same one for Chrome and Edge. A website can't log your browser into
Steam; an extension can.

**Open Steam** is still there too. It shows Steam through the site, and the bot's login never leaves bot_manager.
It doesn't do backpack.tf.

## Install (once per browser)

1. Admin → Bot manager → Bots → "Chrome window as a bot" (in Edge: "Edge window as a bot") → **Download the
   extension**. Unzip it somewhere it can stay, because the browser loads it from that folder every time. On Windows:
   right-click `tf2deal-bot-browser.zip` → **Extract All** → Extract. You get a `tf2deal-bot-browser` folder with
   `manifest.json` right in it.
2. Open the extensions page by typing it in the address bar:
   - Chrome: `chrome://extensions`, switch on **Developer mode** (top right);
   - Edge: `edge://extensions`, switch on **Developer mode** (in the menu on the left).

   Click **Load unpacked** and pick the `tf2deal-bot-browser` folder (the one with `manifest.json` in it).
3. Click **Details** on "tf2deal admin: bot browser" and switch on **Allow in Incognito** (Edge: **Allow in
   InPrivate**). Without it the extension can't open the private window and the admin page says so.
4. Reload the admin page. The card says "Installed, version …".

The card also tells you when a newer version is available. To update, download it again, unzip it over the old
folder (replace the files), and click **Reload** on the extension in the extensions page.

Version 1.0.0 came in a zip with a folder inside (`tf2deal-bot-browser-1.0.0`). For 1.1.0, remove the old
extension in the extensions page, then load the new `tf2deal-bot-browser` folder as in step 2 and do step 3 again.

## How it works

1. "Open in Chrome" / "Open in Edge" asks the site for the bot's web login (`POST /api/admin/bot_browser/login`, admin session only).
   The site asks bot_manager for it (`admin:steam:cookies`). bot_manager sends the bot's current web session:
   - `steamLoginSecure` and `sessionid` for steamcommunity.com, store.steampowered.com and help.steampowered.com;
   - `steamLoginSecure` is an access token that ends within a day;
   - never the password, the shared or identity secret, or the refresh token.
2. The page hands the login to the extension (`extension/bridge.js`). This only runs on `https://tf2deal.com/admin…`
   and on localhost.
3. The extension (`extension/background.js`) does this:
   - opens a private (incognito / InPrivate) window. A browser may hand the extension no window back for a private
     one even though it opens it, so the extension also watches for the new private window and looks up its tab and
     cookie jar for up to 2 seconds;
   - puts the cookies into the private windows' cookie jar only;
   - blocks Steam's dangerous addresses (see Safety);
   - opens `steamcommunity.com/profiles/<bot>/` and `backpack.tf/login`.
4. backpack.tf sends the window to Steam's "Sign in through Steam" page. In the bot's window only, and only for
   backpack.tf, `extension/openid.js` clicks Sign in for you, at most once every 30 seconds so it can't loop.

## Safety

- **Your own Steam login is never touched.** Normal windows keep their own cookies, and the bot's login only goes
  into the private windows' jar.
- **One bot at a time.** All private windows of a browser share one cookie jar, so opening another bot closes the first
  bot's window. A private window you already had open would also see the bot's Steam login. Close private windows
  you use for yourself first.
- **The bot can't be logged out by accident.** While the bot's window is open, Steam addresses containing these are
  blocked: `logout`, `deauthorize`, `revoke`, `removeauthenticator`, `twofactor/remove`, `twofactor/manage_action`,
  `phone/remove`. The browser then shows that the page was blocked by an extension. They would end the bot's own Steam login,
  revoke its tokens or remove its authenticator. The browser can't apply a rule to one window only, so the block covers
  every window while the bot's window is open. Close it to log yourself out of Steam.
- **Closing the window cleans up.** The Steam and backpack.tf cookies of the private jar are deleted and the block
  ends. The browser also forgets everything private when the last private window closes.
- The login handed out ends with its access token, within a day. After that, open the bot again from Admin (if Steam
  shows the bot logged out, click "New web session" on the bot first).
- The site and bot_manager log every hand-out: site console `bot browser: <bot> opened in the browser of <admin>`,
  bot_manager console + audit log `admin:steam:cookies` (payload only, never the cookies).

## Other domains

The extension talks only to admin pages on `tf2deal.com`, `www.tf2deal.com`, `localhost` and `127.0.0.1`. To use it
with another domain, add it to `content_scripts[0].matches` in `extension/manifest.json`, add it to `ADMIN_PAGE` in
`extension/background.js`, and reload the extension.
