# Site news: the updates page and the news window

Every feature added to the site is listed on the updates page, **/news** (linked as "What's new" in the footer of every
page, and from the news and welcome windows), newest first, with the day and time it went live and a short
description. Giveaways and blog posts are not on it: they have their own pages.

When a big feature goes live, every visitor who hasn't seen it yet also gets a window about it once, a moment after the
page has loaded. Only the newest one is ever shown.

Nothing is written in the admin panel: the feature's own pull request carries its news, so it goes live when the
update is pulled on the server (`git pull` + restart).

## Adding the news for a feature

In the pull request that adds the feature:

1. **The entry.** At the top of `NEWS` in `src/service/news.js`:

   ```js
   { key: 'raffles', date: '2026-11-20', href: '/giveaway', image: 'raffles', window: true },
   ```

   - `key`: a-z, 0-9 and `_`, never reused.
   - `date`: the day it goes live. An entry dated later than today waits for its day. The time of day is filled in
     by the site: the first time its server runs with the entry out (after `git pull` + restart, or at the start of
     the day it's dated) is written down once (`news_times` collection) and shown on /news in each visitor's own time
     zone. To set the time yourself, write `'2026-11-20 18:00'` (UTC).
   - `href`: the page the main button opens. Or `action` for something the button does on the page instead
     (`themes` opens the language and theme window; new actions go in `ACTIONS` in `src/public/js/welcome.js` and
     `src/service/news.js`).
   - `window: true` for a big feature: one visitors will use, like raffles or posting trades. Leave it out for
     smaller changes; those are on /news and get a line in the welcome window's "What's new".
   - `image`: optional, see 3.

2. **The texts**, in all 8 `src/locales/<lang>.json`, under `news.items.<key>`:

   ```json
   "raffles": {
     "title": "Raffles are here",
     "text": "Two or three sentences: what it is and why it's worth a try.",
     "button": "See the raffles"
   }
   ```

   `title` and `text` for every entry: /news shows both, so the text says in two or three sentences what the feature
   is and where to find it. `button` for entries with `window: true` (other entries get "Take a look" on /news). The
   kicker ("New on TF2Deal"), the date and the time are added by the page and the window.

3. **The picture** (optional, but a window with one is much more inviting): `src/public/img/news/<image>-1200.webp`
   at 1200 x 500 and `<image>-640.webp` at 640 x 267. Show the feature itself, made from screenshots of the real
   site. Transparent parts let the window's own colour through, so one picture works in every theme (the themes
   picture is three phone screenshots with transparent gaps). Words in the picture aren't translated, so keep it to
   the site itself.

4. `npm test` checks the list: unique keys, valid dates, the newest on top, every text in all 8 languages, both
   pictures in the right size. GitHub runs it on every pull request.

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

## The updates page

`/news` (`src/view/news.ejs`, styles `src/public/scss/partials/views/_news.scss`) lists every entry that is out, newest
first: the date and time on the left, the feature on the right (the picture too, if it has one), with where it is on
the site (Items, Trade, Theme) and its link or button. The times are printed in UTC and shown in the visitor's time
zone in the browser. The page is in the sitemap; its lastmod is the moment the newest feature went live. Opening it
counts as having seen the news window's feature, so that window doesn't open there. `/updates` moves to it.

## Taking a news down

To stop the window: remove `window: true` from the entry and deploy (it stays on /news). Keep the entry itself:
visitors who saw it count as having seen everything older too, which only works while it's in the list. The newest earlier entry with `window: true` then
shows to the visitors who haven't seen it; to show nothing at all, remove `window: true` from those as well.

To take a feature off /news as well, remove its entry; visitors who saw only that one get the window again.

Files: `src/service/news.js` (the list), `src/service/news_times.js` (the go-live times),
`src/view/news.ejs` (the updates page), `src/view/partials/news_modal.ejs` (the window),
`src/public/js/welcome.js` (when it opens), `GET /api/news` and `POST /api/news/seen` in `src/api/index.js`, styles in
`src/public/scss/partials/_welcome.scss`.
