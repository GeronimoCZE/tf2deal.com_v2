# Setting up tf2deal.com

## What you need

- [Node.js](https://nodejs.org) 18 or newer
- A MongoDB database (for example a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster)
- A [Steam Web API key](https://steamcommunity.com/dev/apikey)
- The tf2deal bot server, running separately

## Start the site

1. Download this project and open a terminal in its folder.
2. Run `npm install` once.
3. Copy `.env.example` to `src/config/.env` and fill in the values. Each line explains what it is for.
   - `SESSION_SECRET` must be a long random text of at least 32 characters.
4. Run `npm run dev-app`. The site opens at http://localhost:8080.

While you work on the styles, `npm run dev` also rebuilds the CSS whenever a `.scss` file changes.

## Admin panel

1. Sign in with Steam using the account set in `ADMIN_STEAMID`.
2. Open `/login` and enter `ADMIN_PASSWORD`.
3. The panel is at `/admin`. Access lasts one hour.

## Giveaway announcements (optional)

When you start a giveaway, the site can post it on your Steam group and your Facebook Page, and remove both posts
again when the giveaway ends or is cancelled. Each one is switched on by filling in its values in `src/config/.env`
and restarting the site. Leave them empty and nothing is posted.

The admin panel shows under each giveaway whether its posts went out and were removed. A post that fails never stops
the giveaway. If removing one fails, the site tries again every 10 minutes for a day; after that the panel asks you
to delete it by hand.

### Steam group

- `STEAM_GROUP_ID`: the group's id number. Open `https://steamcommunity.com/groups/YOURGROUP/memberslistxml/?xml=1`
  and copy the number in `<groupID64>`. The giveaway's group check also takes the group's URL name, and uses
  `tradetf2deal` (the group the giveaway page links to) when this is empty. It looks players up in the group's
  public member list, so players with a private Steam profile can join too.
- `STEAM_GROUP_ACCOUNT` and `STEAM_GROUP_PASSWORD`: the sign-in name and password of the Steam account that posts.
  - It has to be an **officer of the group**: on the group page open the members list, click the account and
    promote it to officer.
  - Don't use a trading bot's account. Use your own account or one made for this.
  - The site signs in on the Steam website only, like a browser. It doesn't log the account out of the Steam app.
- `STEAM_GROUP_SHARED_SECRET`: the `shared_secret` of the account's Steam Guard mobile authenticator (for example
  the `shared_secret` line in the `.maFile` of Steam Desktop Authenticator). The site makes the sign-in code with it.
  Accounts with Steam Guard codes by e-mail can't be used, because nobody is there to type the code.

### Facebook Page

- `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_TOKEN`: your Page's id and a Page access token that can post on it.

To get them (you need to be an admin of the Page):

1. On [developers.facebook.com](https://developers.facebook.com/apps) create an app (My Apps → Create App) for
   managing your Page.
2. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer), pick your app and add the
   permissions `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`. Click **Generate Access Token**
   and allow it for your Page.
3. That token only lasts an hour. Paste it into the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken)
   and click **Extend Access Token** at the bottom. Copy the new token.
4. Back in the Graph API Explorer, paste the new token, run `me/accounts` and find your Page in the answer. Its
   `id` is `FACEBOOK_PAGE_ID` and its `access_token` is `FACEBOOK_PAGE_TOKEN`. In the Access Token Debugger this
   token should say "Expires: Never".
5. If your app has a Development / Live switch, set it to Live (it asks for a privacy policy link under App settings →
   Basic). While it's in Development, Facebook may show the posts only to you.

If you change your Facebook password or remove the app from your Page, the token stops working: make a new one the
same way.

## Keep your secrets safe

- **Never upload `src/config/.env`.** It holds your passwords and keys, and it is already excluded from Git.
- If a key has ever been shared or uploaded, create a new one at the service that issued it.
