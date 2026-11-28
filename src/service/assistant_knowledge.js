// What the chat helper (service/assistant.js) knows about the site: public texts only, put together from files that
// are already public, so it can never know more than a visitor can read on the site:
//
//   public/llms.txt          what the site is, who runs it, how trading works, prices, safety, pages, community links
//   locales/en.json          the home page FAQ, the About page's "How to trade", the Keys page's "How it works",
//                            the giveaway rules
//   service/news.js          every feature on the updates page (/news), with its title and text: new features reach
//                            the helper by themselves, with the pull request that adds them
//
// Nothing comes from the database or from anything a visitor or an app can write: no blog posts, no item custom
// names, no Steam names, no settings. The text is built again at most every 10 minutes (a news entry dated ahead
// shows up on its day) and is the same for everyone, so the model keeps it in its prompt cache.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import * as site_news from './news.js'
import { translate } from '../i18n.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const EVERY = 10 * 60 * 1000

const en = (key, vars) => translate('en', key, vars)
// the locale texts are written for pages: a few carry HTML (<span>Yes</span>) or a {link} the page fills in
const plain = (text) => String(text || '').replace(/<[^>]*>/g, '').replace(/\s*\{link\}/g, '').replace(/\s+/g, ' ').trim()

// llms.txt without its part for crawling agents (Markdown pages, robots.txt), which a chat visitor doesn't need
const llms_text = () => {
  try {
    const text = fs.readFileSync(path.join(root, 'public/llms.txt'), 'utf8')
    return text.replace(/\n## For AI agents\n[\s\S]*?(?=\n## |\s*$)/, '\n').trim()
  } catch (error) {
    console.log('Chat helper: public/llms.txt could not be read:', error.message)
    return '# TF2Deal.com\n\nTF2Deal.com is an automated Team Fortress 2 item trading website with Steam trade bots.'
  }
}

// the home page FAQ (views/home.ejs): [question, answer] keys
const FAQ = ['how', 'limits', 'pure_html', 'money_html', 'deposits_html', 'refunds_html', 'legit_html', 'owner', 'bot', 'sell']
const faq_text = () => FAQ.map((k) => {
  const [name, html] = k.split('_')
  return `- ${plain(en(`faq.${name}_q`))} ${plain(en(`faq.${name}_a${html ? '_html' : ''}`))}`
}).join('\n')

const how_to_trade = () => [
  `- Trade page: ${plain(en('about.how_trade'))}`,
  `- Item page: ${plain(en('about.how_items'))}`,
  `- backpack.tf: ${plain(en('about.how_bptf'))}`
].join('\n')

// the Keys page (/keys): its own "How it works" lines, with the page's usual numbers
const key_bank_text = () => {
  const vars = { max: 5, minutes: 10 }
  return [
    plain(en('keys.lede', vars)),
    `- ${plain(en('keys.how_1_title'))}: ${plain(en('keys.how_1', vars))}`,
    `- ${plain(en('keys.how_2_title'))}: ${plain(en('keys.how_2', vars))}`,
    `- ${plain(en('keys.how_3_title'))}: ${plain(en('keys.how_3', vars))}`
  ].join('\n')
}

// the giveaway page's "How to enter" (views/giveaway.ejs)
const giveaway_text = () => [
  `To enter the current giveaway, open /giveaway, sign in through Steam and press "${plain(en('giveaway.enter'))}".`,
  'Some giveaways also ask you to join the site\'s Steam group (https://steamcommunity.com/groups/tradetf2deal)',
  `or to ${plain(en('giveaway.req_trade')).toLowerCase()}; the giveaway page lists what the current one asks.`,
  'A giveaway needs a minimum number of entries: until enough people are in, it stays open past its end time.',
  'The winner is drawn at random and gets the prize as a Steam trade offer from one of the site\'s bots.'
].join(' ')

// every feature that is out, newest first (the updates page)
const features_text = () => site_news.published().map((entry) => {
  const title = plain(en(`news.items.${entry.key}.title`))
  const text = plain(en(`news.items.${entry.key}.text`))
  return `- ${String(entry.date).slice(0, 10)}: ${title}. ${text}`
}).join('\n')

const build = () => [
  llms_text(),
  '## Frequently asked questions (home page)',
  faq_text(),
  '## Ways to trade (About page)',
  how_to_trade(),
  '## Key bank (/keys)',
  key_bank_text(),
  '## Giveaways (/giveaway)',
  giveaway_text(),
  '## Site features, newest first (the What\'s new page, /news)',
  features_text()
].join('\n\n')

let kept = { text: '', at: 0 }

// the site's public facts, as one text for the system prompt
export const text = () => {
  if (!kept.text || Date.now() - kept.at > EVERY) kept = { text: build(), at: Date.now() }
  return kept.text
}
