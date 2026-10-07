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

## Keep your secrets safe

- **Never upload `src/config/.env`.** It holds your passwords and keys, and it is already excluded from Git.
- If a key has ever been shared or uploaded, create a new one at the service that issued it.
