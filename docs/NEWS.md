# Site news: the news window

When a new feature goes live, every visitor who hasn't seen it yet gets a window about it once, a moment after the
page has loaded. Only the newest feature is ever shown. Nothing is written in the admin panel: the feature's own pull
request carries its news, so the window starts the day the update is pulled on the server (`git pull` + restart).

## Adding the news for a feature

In the pull request that adds the feature:

1. **The entry.** At the top of `NEWS` in `src/service/news.js`:

   ```js
   { key: 'raffles', date: '2026-11-20', href: '/giveaway', image: 'raffles', window: true },
   ```

   - `key`: a-z, 0-9 and `_`, never reused.
   - `date`: the day it goes live. An entry dated later than today waits for its day.
   - `href`: the page the main button opens. Or `action` for something the button does on the page instead
     (`themes` opens the language and theme window; new actions go in `ACTIONS` in `src/public/js/welcome.js` and
     `src/service/news.js`).
   - `window: true` for a big feature: one visitors will use, like raffles or posting trades. Leave it out for
     smaller changes; those only get a line in the welcome window's "What's new".
   - `image`: optional, see 3.

2. **The texts**, in all 8 `src/locales/<lang>.json`, under `news.items.<key>`:

   ```json
   "raffles": {
     "title": "Raffles are here",
     "text": "Two or three sentences: what it is and why it's worth a try.",
     "button": "See the raffles"
   }
   ```

   `title` for every entry. `text` and `button` for entries with `window: true`. The kicker ("New on TF2Deal") and the
   date are added by the window.

3. **The picture** (optional, but a window with one is much more inviting): `src/public/img/news/<image>-1200.webp`
   at 1200 x 500 and `<image>-640.webp` at 640 x 267. Show the feature itself, made from screenshots of the real
   site. Transparent parts let the window's own colour through, so one picture works in every theme (the themes
   picture is three phone screenshots with transparent gaps). Words in the picture aren't translated, so keep it to
   the site itself.

4. `npm test` checks the list: unique keys, the newest on top, every text in all 8 languages, both pictures in the
   right size. GitHub runs it on every pull request.

To look at the window, open any page with `#news` at the end of the address, like `https://tf2deal.com/#news`. It
shows even when you have seen it.

## Who sees it

- Visitors who have been on the site before, once per feature. Closing the window (Close, the x, Esc, a click beside
  it), its button or its link counts as seen.
- Brand-new visitors get the welcome window instead, whose "What's new" list always has the newest feature in it.
  Closing that counts as seen too, so nobody gets both.
- What a browser has seen is saved in it (`td_news`). For a signed-in user it's saved on the account as well
  (`users.news_seen`), so the window doesn't come back on their phone after they closed it on their computer.
- Not over another window (trade URL, welcome, settings): it waits for the next page. Not for search engine robots.
- A visitor who missed several features only sees the newest one.

## Taking a news down

Remove `window: true` from the entry and deploy. Keep the entry itself: visitors who saw it count as having seen
everything older too, which only works while it's in the list. The newest earlier entry with `window: true` then
shows to the visitors who haven't seen it; to show nothing at all, remove `window: true` from those as well.

Files: `src/service/news.js` (the list), `src/view/partials/news_modal.ejs` (the window),
`src/public/js/welcome.js` (when it opens), `GET /api/news` and `POST /api/news/seen` in `src/api/index.js`, styles in
`src/public/scss/partials/_welcome.scss`.
