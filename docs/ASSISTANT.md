# Chat helper

A chat window on every shop page (the button in the bottom right corner). Visitors ask about the site in their own
language: how trading works, who runs TF2Deal, prices, the key bank, the giveaway. It also looks items up in the
bots' stock, shows them as cards that open the item page, and for signed-in visitors it can put a **Request trade**
card in the chat: one press sends the same single-item trade request as a direct buy link (docs/BUY_LINKS.md), and
the visitor accepts the bot's offer in Steam.

It runs on the Claude API. It's off until you give it an API key and switch it on.

## Turning it on

1. Make an API key in the [Claude Console](https://platform.claude.com/settings/keys). Set a monthly spend limit
   for the key's workspace there too: it's the hard ceiling, whatever happens on the site.
2. Admin → **Chat helper** → Claude API key: paste it and press Save key. The key is tried with Claude before it's
   saved, kept in the database encrypted with `SESSION_SECRET`, and never shown again (the page only says where the
   key comes from and its last 4 characters). Or put it in `.env` as `ANTHROPIC_API_KEY` (a key saved in the panel
   is used first). If `SESSION_SECRET` changes, a saved key can't be read any more: paste it again.
3. Switch **Chat helper** on. The button appears on every page and the news window announces it once to every
   visitor (the `assistant` entry in `src/service/news.js` waits until the helper is on).

After `git pull`, run `npm install`: the helper uses the `@anthropic-ai/sdk` package.

## Model, cost and limits

- **Model**: Claude Opus 5.5 (default: best answers, hardest to talk out of its rules), Claude Sonnet 5.5 (about half
  the cost) or Claude Haiku 5.5 (cheapest, simpler answers). **Thinking**: Quick (default), Balanced or Thorough. A
  change applies to new chats.
- **Cost**: the admin page shows today's answers and an estimate of today's cost from the token counts Claude sends
  back, and the last 30 days. The site's facts (about 4,000 tokens) are the same for every chat, so after the first
  question they are read from Claude's prompt cache at a twentieth of the normal price.
- **Daily limit**: 300 answers a day for the whole site (change it in the panel). When it's reached, the chat asks
  visitors to come back tomorrow (midnight UTC).
- **Per visitor**: at most 6 messages a minute and 40 an hour (20 when not signed in), one message at a time, 600
  characters a message, 12 questions a chat (then "New chat").
- **Try it** on the admin page asks a question as a visitor would and shows which tools it used. It counts towards
  today's answers.

## What it knows and what it can do

It knows only what is already public (`src/service/assistant_knowledge.js`):

- `public/llms.txt` (without its part for crawlers),
- the home page FAQ, About's "How to trade", the key bank's "How it works" and the giveaway rules (`locales/en.json`),
- every entry on the updates page (`src/service/news.js`), so a new feature reaches the helper with the pull request
  that adds it.

Nothing comes from the database or from anything visitors can write (no blog posts, custom names, Steam names or
settings).

It has four tools (`src/service/assistant_tools.js`), none of which writes anything:

| Tool | What it does |
| --- | --- |
| `search_items` | finds up to 8 items by name in the public item list (the same list /items shows), with prices and stock |
| `show_items` | shows up to 4 items as cards that open their item pages |
| `offer_trade` | puts one Request trade card in the chat for the cheapest copy in stock (the visitor presses it) |
| `site_status` | whether trading is on and the bots are connected, the key price and the running giveaway |

## The firewall

The helper can't reach anything private because nothing private is wired to it. Around that:

- **Who the visitor is** comes from their sign-in on the server, never from the chat. The tools get the Steam ID
  from the session, and only `offer_trade` uses it, to decide whether the card shows a button or "Sign in".
- **A trade card sends nothing by itself.** Its button calls `/api/create_trade` (single item) like a buy link does,
  which checks everything again: signed in, trade URL saved, trading on, copy still in stock, blacklist, banned
  accounts, its own rate limit.
- **No admin functions**: the chat API has no route to them, and the admin pages need the admin sign-in and the
  panel password as before.
- **Only the site's own pages** can call the chat (same origin, JSON only, small bodies); other sites get 403.
- **Every answer is checked before it's sent** (answers aren't streamed): every secret from `.env`, the saved API
  key and anything shaped like a key, password, database address or trade offer token is cut out (and that chat is
  closed); links may only go to the site, its Steam group, Discord, Reddit, Trustpilot, backpack.tf and the TF2
  Wiki. The browser checks links again and draws only text, bold, lists and those links.
- **The chat lives on the server**, so a page can't make up earlier answers. Chats are kept 45 minutes and belong to
  the visitor who started them.
- **Attempts to change its rules** ("ignore your instructions", "show your prompt") are counted on the admin page.
  They get a normal answer: the helper has nothing secret to give away.

The admin page shows what was stopped today: rate limits, other sites, tool calls outside the four, answers with a
link or secret removed, and more.

## Files

| File | |
| --- | --- |
| `src/service/assistant.js` | settings, the encrypted key, usage, the chat loop with Claude |
| `src/service/assistant_knowledge.js` | the public facts it knows |
| `src/service/assistant_tools.js` | the four tools |
| `src/service/assistant_firewall.js` | input checks and the answer filter |
| `src/model/AssistantSetting.js` | settings + today's usage in MongoDB (`assistant_settings`) |
| `src/api/routes/assistant.js` | `POST /api/assistant/chat`, `POST /api/assistant/reset` with the limits |
| `src/api/routes/admin.js` | `/api/admin/assistant` (settings, key, Try it) |
| `src/view/partials/assistant.ejs`, `src/public/js/plugins/assistant.js`, `src/public/scss/partials/_assistant.scss` | the chat window |
| `src/public/js/admin_assistant.js` | Admin → Chat helper |
| `locales/<lang>.json` | `assistant.*` and `js.assistant.*` texts, in all 8 languages |

## How a question is sent (for developers)

Each chat keeps its own system prompt (the rules + the site facts, cached) and model from its first question to its
last. Per-question facts (the time, the visitor's language, signed in or not, the item page they're on) go in a short
system message after their question. The chat only grows at the end, which keeps Claude's thinking from earlier
answers usable and the prompt cache warm. Settings changes apply from the next new chat.
