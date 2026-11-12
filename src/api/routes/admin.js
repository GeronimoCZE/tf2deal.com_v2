import express from 'express';
import mongoose from 'mongoose';

import * as fn from '../../fn.js'
import { item_model } from '../../model/Item.js';
import { blog_model } from '../../model/Blog.js';
import { ticket_model } from '../../model/Ticket.js';
import { giveaway_model } from '../../model/Giveaway.js';
import User from '../../model/User.js';
import { refresh_state, draw_winner, cancel as cancel_giveaway, recent_view } from '../../service/giveaway.js';
import * as giveaway_prize from '../../service/giveaway_prize.js';
import * as giveaway_posts from '../../service/giveaway_posts.js';
import * as translate from '../../service/translate.js';
import * as sitemap from '../../service/sitemap.js';
import * as blog_render from '../../service/blog_render.js';
import * as uploads from '../../service/uploads.js';
import { LANGS, LANG_NAMES } from '../../i18n.js';
import { trade_model } from '../../model/Trade.js';
import { rating_model } from '../../model/Rating.js';
import * as settings from '../../service/settings.js';
import * as season from '../../service/season.js';
import * as notifications from '../../service/notifications.js';
import * as stock_limits from '../../service/stock_limits.js';
import * as listings from '../../service/listings.js';
import * as bot_manager from '../../service/bot_manager.js';
import * as manual_prices from '../../service/manual_prices.js';
import * as bot_accounts from '../../service/bot_accounts.js';
import * as latest_trades from '../../service/latest_trades.js';
import { notification_model } from '../../model/Notification.js';
import { clients as settings_clients } from '../../service/settings_socket.js';
import { bot_socket, item_socket } from '../../service/socket.js';
import * as app from '../../app.js';
import { has_admin_session } from '../../mw.js';
import * as inventory_value from '../../service/inventory_value.js';
import * as flips from '../../service/flips.js';
import * as stats from '../../service/stats.js';
import * as memory from '../../service/memory.js';
import * as crawlers from '../../service/crawlers.js';

export const router = express.Router();

// Express 4 doesn't forward errors thrown in async handlers, so pass them to the error handler at the bottom.
for (const method of ['get', 'post']) {
  const register = router[method].bind(router);
  router[method] = (path, ...handlers) => register(path, ...handlers.map((handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)));
}

// Same access as the /admin pages: the admin steam account + the admin password entered on /login (mw.js)
router.use('/', (req, res, next) => {
  if(has_admin_session(req)){
    return next();
  }
  res.status(511).json({ status: 'error', message: 'You are not allowed to GET/POST data in here!' })
});

const valid_id = (req, res, next) => {
  if(mongoose.Types.ObjectId.isValid(req.params.id)){ return next(); }
  res.status(404).json({ status: 'error', message: 'Not found.' })
};

const text = (value, max) => (typeof value == 'string') ? value.trim().slice(0, max) : '';

/* ========================= TICKETS ========================= */

router.get('/tickets', async (req, res) => {
  const filter = ['open', 'answered', 'closed'].includes(req.query.status) ? { status: req.query.status } : {};
  const tickets = await ticket_model.find(filter).sort({ updated: -1 }).limit(100).lean();
  res.json({ status: 'ok', tickets });
});

router.post('/tickets/:id/reply', valid_id, async (req, res) => {
  const reply = text(req.body?.text, 2000);
  if(!reply){ return res.status(400).json({ status: 'error', message: 'Write a reply first.' }) }

  const now = Date.now();
  const ticket = await ticket_model.findOneAndUpdate(
    { _id: req.params.id },
    { $push: { messages: { from: 'admin', text: reply, created: now } }, $set: { status: 'answered', updated: now } },
    { new: true }
  ).lean();
  if(!ticket){ return res.status(404).json({ status: 'error', message: 'Ticket not found.' }) }
  notifications.notify({ to: ticket.steamid, type: 'ticket_reply', vars: { id: String(ticket._id) }, link: '/profile/tickets' });
  res.json({ status: 'ok', ticket });
});

router.post('/tickets/:id/close', valid_id, async (req, res) => {
  const ticket = await ticket_model.findOneAndUpdate({ _id: req.params.id }, { $set: { status: 'closed', updated: Date.now() } }, { new: true }).lean();
  if(!ticket){ return res.status(404).json({ status: 'error', message: 'Ticket not found.' }) }
  res.json({ status: 'ok', ticket });
});

/* ========================= BLOG ========================= */

const BLOG_LAYOUTS = ['standard', 'feature', 'guide'];

const blog_fields = (body) => ({
  title: text(body?.title, 150),
  slug: fn.slugify(text(body?.slug, 100) || text(body?.title, 150)),
  cover: text(body?.cover, 500),
  excerpt: text(body?.excerpt, 300),
  content: text(body?.content, 50000),
  published: body?.published === true || body?.published === 'true',
  lang: LANGS.includes(body?.lang) ? body.lang : 'en', // the language the post is written in
  layout: BLOG_LAYOUTS.includes(body?.layout) ? body.layout : 'standard',
  seo_title: text(body?.seo_title, 120),
  seo_description: text(body?.seo_description, 320)
});

// AI translation state for the admin panel (service/translate.js)
const translation_info = () => ({ enabled: translate.enabled(), service: translate.describe(), langs: LANGS, names: LANG_NAMES });
const with_translation = (post) => {
  const { translations, translation_errors, ...rest } = post;
  return { ...rest, translation: { status: translate.status(post, translate.BLOG_FIELDS), errors: translation_errors || {}, queued: translate.is_queued('post', post._id) } };
};

router.get('/blog', async (req, res) => {
  const posts = await blog_model.find({}).sort({ created: -1 }).lean();
  // the list doesn't need the text itself (only to work out the translation state)
  res.json({ status: 'ok', translation: translation_info(), posts: posts.map((post) => { const { content, ...rest } = with_translation(post); return rest; }) });
});

// the editor's preview: the post as the page shows it (item cards with live prices), with its contents and reading time
router.post('/blog/preview', async (req, res) => {
  const post = await blog_render.render(text(req.body?.content, 50000), { title: text(req.body?.title, 150), __: req.__, lurl: req.lurl });
  res.json({ status: 'ok', html: post.html, toc: post.toc, words: post.words, minutes: post.minutes, images: post.images });
});

// pictures for posts and covers (service/uploads.js): the file itself as the request body
router.post('/blog/upload', express.raw({ type: () => true, limit: uploads.MAX_BYTES }), async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await uploads.save('blog', req.body)) });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

router.get('/blog/uploads', async (req, res) => {
  res.json({ status: 'ok', files: await uploads.list('blog') });
});

// item names for the editor's item card block (the names the item pages use)
router.get('/blog/items', async (req, res) => {
  const q = text(req.query.q, 100);
  if(q.length < 2){ return res.json({ status: 'ok', items: [] }) }
  const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const items = await item_model.find({ bp_sku: pattern, sell: { $gt: 0 } }, { bp_sku: 1, image: 1, qualityID: 1, 'stock.cur': 1 })
    .sort({ 'stock.cur': -1 }).limit(12).maxTimeMS(5000).lean();
  res.json({ status: 'ok', items: items.map((item) => ({ bp_sku: item.bp_sku, image: item.image, qualityID: item.qualityID, stock: item.stock?.cur || 0 })) });
});

router.get('/blog/:id', valid_id, async (req, res) => {
  const post = await blog_model.findById(req.params.id).lean();
  if(!post){ return res.status(404).json({ status: 'error', message: 'Post not found.' }) }
  res.json({ status: 'ok', translation: translation_info(), post: with_translation(post) });
});

// translate again into every language (e.g. after improving the prompt or the model)
router.post('/blog/:id/translate', valid_id, async (req, res) => {
  if(!translate.enabled()){ return res.status(400).json({ status: 'error', message: 'AI translation is off: set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (free) or ANTHROPIC_API_KEY in .env.' }) }
  const post = await blog_model.findById(req.params.id, { published: 1 }).lean();
  if(!post){ return res.status(404).json({ status: 'error', message: 'Post not found.' }) }
  if(!post.published){ return res.status(400).json({ status: 'error', message: 'Publish the post first: drafts are not translated.' }) }
  translate.queue_post(post._id, true);
  res.json({ status: 'ok' });
});

router.post('/blog', async (req, res) => {
  const fields = blog_fields(req.body);
  if(!fields.title || !fields.slug || !fields.content){
    return res.status(400).json({ status: 'error', message: 'Title and text are required.' })
  }
  if(await blog_model.exists({ slug: fields.slug })){
    return res.status(400).json({ status: 'error', message: `A post with the url /blog/${fields.slug} already exists.` })
  }
  const now = Date.now();
  const post = await new blog_model({ ...fields, source_hash: translate.source_hash(fields, translate.BLOG_FIELDS), created: now, updated: now }).save();
  if(post.published){ translate.queue_post(post._id); sitemap.refresh() } // in the sitemap + IndexNow now
  res.json({ status: 'ok', translation: translation_info(), post: with_translation(post.toObject()) });
});

router.post('/blog/:id', valid_id, async (req, res) => {
  const fields = blog_fields(req.body);
  if(!fields.title || !fields.slug || !fields.content){
    return res.status(400).json({ status: 'error', message: 'Title and text are required.' })
  }
  if(await blog_model.exists({ slug: fields.slug, _id: { $ne: req.params.id } })){
    return res.status(400).json({ status: 'error', message: `A post with the url /blog/${fields.slug} already exists.` })
  }
  const post = await blog_model.findOneAndUpdate({ _id: req.params.id }, { $set: { ...fields, source_hash: translate.source_hash(fields, translate.BLOG_FIELDS), updated: Date.now() } }, { new: true }).lean();
  if(!post){ return res.status(404).json({ status: 'error', message: 'Post not found.' }) }
  if(post.published){ translate.queue_post(post._id) } // only the languages whose translation is outdated
  sitemap.refresh(); // new lastmod (or the post left the sitemap when unpublished), sent to IndexNow
  res.json({ status: 'ok', translation: translation_info(), post: with_translation(post) });
});

router.post('/blog/:id/delete', valid_id, async (req, res) => {
  await blog_model.deleteOne({ _id: req.params.id });
  sitemap.refresh();
  res.json({ status: 'ok' });
});

/* ========================= GIVEAWAYS ========================= */

router.get('/items/search', async (req, res) => {
  const q = text(req.query.q, 100);
  if(q.length < 2){ return res.json({ status: 'ok', items: [] }) }
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const items = await item_model.find({ bp_sku: { $regex: regex } }, { _id: 0, bp_sku: 1, image: 1, qualityID: 1, effectID: 1 }).limit(10).lean();
  res.json({ status: 'ok', items });
});

// steamid64 / asset id as sent by the panel
const steamid64 = (v) => /^\d{17}$/.test(String(v || '')) ? String(v) : ''
const asset_id = (v) => /^\d{1,20}$/.test(String(v || '')) ? String(v) : ''
const image_url = (v) => /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/.test(String(v || '')) ? String(v).slice(0, 500) : ''

router.get('/giveaways', async (req, res) => {
  const giveaways = await giveaway_model.find({}, { entries: 0 }).sort({ created: -1 }).limit(50).lean();
  const counts = await giveaway_model.aggregate([
    { $match: { _id: { $in: giveaways.map((g) => g._id) } } },
    { $project: { n: { $size: '$entries' } } }
  ]);
  const count_of = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

  // the winner's details: trade link, trades and giveaways on the site
  const winner_ids = giveaways.map((g) => g.winner?.steamid).filter(Boolean);
  const winners = await User.find({ steamid: { $in: winner_ids } }, { steamid: 1, tradelink: 1, trades: 1, giveaways: 1, firstlogin: 1 }).lean();

  res.json({ status: 'ok', posts: giveaway_posts.info(), prizes: await giveaway_prize.status(), giveaways: giveaways.map((g) => {
    const user = winners.find((u) => u.steamid == g.winner?.steamid);
    return {
      ...g,
      recent: undefined,
      entry_count: count_of[String(g._id)] || 0,
      entrants: g.status == 'active' ? recent_view({ ...g, entry_count: count_of[String(g._id)] || 0 }).recent.slice(0, 12) : undefined,
      winner_tradelink: user?.tradelink || '',
      winner_user: user ? { trades: user.trades || 0, won: user.giveaways?.won || 0, entries: user.giveaways?.entries || 0, firstlogin: user.firstlogin || null } : null,
      prize_text: g.prize?.state ? (giveaway_prize.PRIZE_TEXT[g.prize.state] || g.prize.state) : '',
      offer_link: giveaway_prize.offer_link(g.prize?.offer_id)
    };
  }) });
});

// the prize picker: every tradable item on the bot accounts, unpriced ones too (bot_manager)
router.get('/giveaways/prize_items', async (req, res) => {
  const result = await giveaway_prize.items({ query: text(req.query.q, 100), offset: req.query.offset, limit: req.query.limit }, req.user?.steamid);
  res.json(result.status == 'ok' ? { status: 'ok', ...(result.data || {}) } : result);
});

// which bot account keeps the prizes
router.get('/giveaways/bank', async (req, res) => {
  const result = await giveaway_prize.bank(req.user?.steamid);
  res.json(result.status == 'ok' ? { status: 'ok', ...(result.data || {}) } : result);
});
router.post('/giveaways/bank', async (req, res) => {
  const steamid = steamid64(req.body?.steamid);
  if(!steamid){ return res.status(400).json({ status: 'error', message: 'Pick a bot.' }) }
  res.json(await giveaway_prize.set_bank(steamid, req.user?.steamid));
});

router.post('/giveaways', async (req, res) => {
  const end = Number(req.body?.end);
  const pick = { bot: steamid64(req.body?.bot), assetid: asset_id(req.body?.assetid) };

  if(await giveaway_model.exists({ status: 'active' })){
    return res.status(400).json({ status: 'error', message: 'End the current giveaway before starting a new one.' })
  }
  if(!(end > Date.now() + 60 * 1000)){
    return res.status(400).json({ status: 'error', message: 'The end date has to be in the future.' })
  }
  if(!pick.bot || !pick.assetid){
    return res.status(400).json({ status: 'error', message: 'Pick the prize from the bot items.' })
  }
  const blocked = await giveaway_prize.status();
  if(blocked != 'ready'){
    return res.status(400).json({ status: 'error', message: blocked == 'offline' ? 'bot_manager is not connected to the site, so the prize can\'t go to the bank bot.' : 'bot_manager doesn\'t have giveaway prizes yet. It needs the events in docs/GIVEAWAY_PRIZES.md.' })
  }

  // shown on the site until bot_manager's answer has the item's own details
  const name = text(req.body?.name, 200);
  const priced = req.body?.priced !== false;
  const item = {
    bp_sku: text(req.body?.bp_sku, 200) || name,
    image: image_url(req.body?.image),
    qualityID: String(Number(req.body?.qualityID) || 6),
    effectID: Number(req.body?.effectID) || 0
  };
  if(!item.bp_sku){ return res.status(400).json({ status: 'error', message: 'That item has no name.' }) }

  const now = Date.now();
  const giveaway = await new giveaway_model({
    item,
    prize: { from_bot: pick.bot, from_assetid: pick.assetid, bot: pick.bot, assetid: pick.assetid, name: name || item.bp_sku, priced, state: 'moving', updated: now },
    description: text(req.body?.description, 500),
    lang: LANGS.includes(req.body?.lang) ? req.body.lang : 'en',
    requirements: {
      steam_group: req.body?.steam_group !== false,
      trade: req.body?.trade !== false
    },
    start: now,
    end,
    created: now
  }).save();

  // the item goes to the bank bot first; if bot_manager refuses, there's no giveaway
  const reserved = await giveaway_prize.reserve(giveaway._id, pick, req.user?.steamid);
  if(reserved.status != 'ok'){
    await giveaway_model.deleteOne({ _id: giveaway._id });
    return res.status(400).json({ status: 'error', message: reserved.message || 'bot_manager didn\'t take the prize.' })
  }
  const known = reserved.data?.item;
  if(known && typeof known == 'object'){
    const set = {};
    if(known.bp_sku || known.name){ set['item.bp_sku'] = text(known.bp_sku || known.name, 200) }
    if(image_url(known.image)){ set['item.image'] = image_url(known.image) }
    if(known.qualityID != null){ set['item.qualityID'] = String(Number(known.qualityID) || 6) }
    if(known.effectID != null){ set['item.effectID'] = Number(known.effectID) || 0 }
    if(known.name){ set['prize.name'] = text(known.name, 200) }
    if(typeof known.priced == 'boolean'){ set['prize.priced'] = known.priced }
    if(Object.keys(set).length){ await giveaway_model.updateOne({ _id: giveaway._id }, { $set: set }) }
  }

  if(giveaway.description){
    await giveaway_model.updateOne({ _id: giveaway._id }, { $set: { source_hash: translate.source_hash(giveaway, translate.GIVEAWAY_FIELDS) } });
    translate.queue_giveaway(giveaway._id);
  }

  const saved = await giveaway_model.findById(giveaway._id).lean();
  await refresh_state();
  notifications.notify({ type: 'giveaway_new', vars: { item: saved.item.bp_sku }, link: '/giveaway' });
  // Steam group and Facebook announcements, posted in the background (the list shows how it went)
  await giveaway_posts.announce(saved).catch((error) => console.log('giveaway: announcing failed', error.message));
  res.json({ status: 'ok', giveaway: saved });
});

router.post('/giveaways/:id/end', valid_id, async (req, res) => {
  const giveaway = await giveaway_model.findOne({ _id: req.params.id, status: 'active' }).lean();
  if(!giveaway){ return res.status(404).json({ status: 'error', message: 'No active giveaway with this id.' }) }
  const { winner, skipped } = await draw_winner(giveaway);
  await refresh_state();
  res.json({ status: 'ok', winner, skipped });
});

router.post('/giveaways/:id/cancel', valid_id, async (req, res) => {
  await cancel_giveaway(req.params.id, req.user?.steamid);
  await refresh_state();
  res.json({ status: 'ok' });
});

// the bank bot's offer to the winner, sent (again) now
router.post('/giveaways/:id/send_prize', valid_id, async (req, res) => {
  res.json(await giveaway_prize.send(req.params.id, req.user?.steamid));
});

// moving the prize to the bank bot failed: try again
router.post('/giveaways/:id/move_prize', valid_id, async (req, res) => {
  const giveaway = await giveaway_model.findById(req.params.id, { prize: 1, status: 1 }).lean();
  if(!giveaway?.prize || giveaway.prize.state != 'move_failed'){ return res.status(400).json({ status: 'error', message: 'The prize is not waiting for a move.' }) }
  res.json(await giveaway_prize.reserve(giveaway._id, { bot: giveaway.prize.from_bot, assetid: giveaway.prize.from_assetid }, req.user?.steamid));
});

router.post('/giveaways/:id/prize_sent', valid_id, async (req, res) => {
  await giveaway_model.updateOne({ _id: req.params.id }, { $set: { prize_sent: req.body?.prize_sent !== false } });
  res.json({ status: 'ok' });
});

/* ========================= NOTIFICATIONS ========================= */
// The bell in the nav. Giveaways and ticket replies add their own; this is for announcements to everyone.

router.get('/notifications', async (req, res) => {
  const items = await notification_model.find({ to: null }).sort({ created: -1 }).limit(50).lean();
  res.json({ status: 'ok', notifications: items.map(notifications.public_view) });
});

router.post('/notifications', async (req, res) => {
  const message = text(req.body?.text, 300);
  const link = text(req.body?.link, 300);
  if(!message){ return res.status(400).json({ status: 'error', message: 'Write the notification first.' }) }
  if(link && !/^\/(?!\/)/.test(link) && !/^https:\/\//.test(link)){
    return res.status(400).json({ status: 'error', message: 'The link has to be a site path like /items or a full https:// address.' })
  }
  const doc = await notifications.notify({ type: 'announcement', text: message, link });
  if(!doc){ return res.status(500).json({ status: 'error', message: "Couldn't save the notification." }) }
  res.json({ status: 'ok', notification: notifications.public_view(doc.toObject()) });
});

router.post('/notifications/:id/delete', valid_id, async (req, res) => {
  await notification_model.deleteOne({ _id: req.params.id });
  res.json({ status: 'ok' });
});

/* ========================= OVERVIEW ========================= */

// average stars, count and 1-5 distribution of the ratings given after trades
const rating_summary = async () => {
  const rows = await rating_model.aggregate([{ $group: { _id: '$stars', count: { $sum: 1 } } }]);
  const dist = [1, 2, 3, 4, 5].map((n) => rows.find((r) => r._id === n)?.count || 0);
  const count = dist.reduce((a, b) => a + b, 0);
  const avg = count ? dist.reduce((sum, c, i) => sum + c * (i + 1), 0) / count : null;
  return { count, avg: avg === null ? null : Math.round(avg * 100) / 100, dist };
};

router.get('/ratings', async (req, res) => {
  if(process.db_status?.connected !== true){ return res.json({ status: 'error', message: 'The database is not connected.' }) }
  const filter = {};
  const stars = Number(req.query.stars);
  if(Number.isInteger(stars) && stars >= 1 && stars <= 5){ filter.stars = stars; }
  const [summary, ratings] = await Promise.all([
    rating_summary(),
    rating_model.find(filter, { _id: 0, steamid: 1, name: 1, stars: 1, comment: 1, offer_id: 1, verified: 1, trustpilot: 1, lang: 1, created: 1 }).sort({ created: -1 }).limit(50).lean()
  ]);
  res.json({ status: 'ok', summary, ratings });
});

// the newest trade records the bots saved, and whether Latest trades on the home page shows each one
router.get('/trade_records', async (req, res) => {
  if(process.db_status?.connected !== true){ return res.json({ status: 'error', message: 'The database is not connected.' }) }
  res.json({ status: 'ok', records: await latest_trades.check(20) });
});

router.get('/overview', async (req, res) => {
  const day_ago = Date.now() - 24 * 60 * 60 * 1000;
  const db = process.db_status?.connected === true;
  const count = (promise) => db ? promise.catch(() => null) : Promise.resolve(null);

  const [users_total, users_new, trades_day, tickets_open, giveaway, rating] = await Promise.all([
    count(User.estimatedDocumentCount()),
    count(User.countDocuments({ firstlogin: { $gte: day_ago } })),
    // trade timestamps may be in ms or in seconds; trades between our own bots don't count
    count(trade_model.countDocuments({ internalTrade: { $ne: true }, $or: [{ timestamp: { $gte: day_ago } }, { timestamp: { $gte: Math.floor(day_ago / 1000), $lt: 1e11 } }] })),
    count(ticket_model.countDocuments({ status: 'open' })),
    db ? giveaway_model.findOne({ status: 'active' }, { item: 1, end: 1, entries: 1 }).lean().catch(() => null) : null,
    db ? rating_summary().catch(() => null) : null
  ]);

  const online = Array.from(app.users.values());
  const trades_total = db ? await stats.trades_total().catch(() => null) : null;
  res.json({ status: 'ok', overview: {
    db,
    uptime: Math.round(process.uptime()),
    memory: memory.summary(),
    crawlers: crawlers.status(),
    bot_server: bot_socket.socket ? 'online' : 'offline',
    item_server: item_socket.socket ? 'online' : 'offline',
    bots: Array.isArray(app.fp_data.bots) ? app.fp_data.bots.length : 0,
    items: Number(app.fp_data.items) || 0,
    trades_reported: Number(app.fp_data.trades) || 0,
    key_price: app.key_price?.metal ?? null,
    users_online: online.length,
    users_trading: online.filter((u) => u.trade).length,
    users_total, users_new, trades_day, trades_total, tickets_open,
    giveaway: giveaway ? { bp_sku: giveaway.item?.bp_sku, image: giveaway.item?.image, end: giveaway.end, entries: giveaway.entries?.length || 0 } : null,
    rating,
    trading: settings.trading_enabled(),
    settings_clients: settings_clients().length
  } });
});

/* ========================= SETTINGS ========================= */

router.get('/settings', (req, res) => {
  res.json({
    status: 'ok',
    loaded: settings.is_loaded(),
    settings: settings.get(),
    public: settings.public_view(),
    socket: { namespace: '/settings', token: settings.admin_token(req.user.steamid) },
    clients: settings_clients(),
    season: season.status()
  });
});

router.post('/settings', async (req, res) => {
  const result = await settings.update(req.body?.patch ?? req.body, { kind: 'admin', name: 'admin panel' });
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

/* ========================= STOCK LIMITS (service/stock_limits.js) ========================= */

const db_ready = (req, res, next) => {
  if(process.db_status?.connected === true){ return next(); }
  res.status(503).json({ status: 'error', message: 'The database is not connected.' })
};

router.get('/stock/global', async (req, res) => {
  const result = await stock_limits.get_global();
  res.status(result.status == 'ok' ? 200 : 502).json(result);
});

router.post('/stock/global', async (req, res) => {
  const result = await stock_limits.set_global(req.body?.patch, 'tf2deal admin panel');
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

router.get('/stock/options', db_ready, async (req, res) => {
  res.json(await stock_limits.options());
});

router.post('/stock/items', db_ready, async (req, res) => {
  res.json(await stock_limits.find_items(req.body?.filters, req.body?.page));
});

// { filters, target: 'item' | 'killstreak', limit: 0-1000 or null (back to the item server's rules) }
router.post('/stock/apply', db_ready, async (req, res) => {
  const limit = (req.body?.limit === null) ? null : Number(req.body?.limit);
  const result = await stock_limits.apply({ filters: req.body?.filters, target: req.body?.target, limit }, `admin ${req.user?.steamid || ''}`.trim());
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

/* ========================= LISTINGS (service/listings.js) ========================= */
// The rules themselves are the live setting `listings` (POST /settings).

router.get('/listings/options', db_ready, async (req, res) => {
  res.json(await listings.options());
});

// ?side=buy|sell&bot=<steamid>&source=auto|manual&q=<name>&page=0&refresh=1
router.get('/listings', async (req, res) => {
  res.json(await listings.list({
    side: text(req.query.side, 4), bot: text(req.query.bot, 20), source: text(req.query.source, 6), q: text(req.query.q, 100),
    page: Number(req.query.page) || 0, refresh: req.query.refresh == '1'
  }));
});

router.get('/listings/item', db_ready, async (req, res) => {
  const result = await listings.item_info(req.query.bp_sku, text(req.query.bot, 20));
  res.status(result.status == 'ok' ? 200 : 404).json(result);
});

router.post('/listings/create', db_ready, async (req, res) => {
  const result = await listings.create(req.body, `admin ${req.user?.steamid || ''}`.trim());
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

// { manual_id } for a listing made by hand, or { id, bot, never: true|false } for one the bots made
router.post('/listings/remove', async (req, res) => {
  const result = await listings.remove(req.body, `admin ${req.user?.steamid || ''}`.trim());
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

/* ========================= BOT MANAGER (service/bot_manager.js) ========================= */
// { event: 'admin:<scope>:<action>', payload } → bot_manager's answer { status: 'ok', data } | { status: 'error', message }.
// The admin's steamid goes along for bot_manager's audit log.

router.post('/bot_manager', async (req, res) => {
  const result = await bot_manager.ask(text(req.body?.event, 80), req.body?.payload, req.user?.steamid);
  res.status(result.status == 'ok' ? 200 : (result.offline ? 503 : 400)).json(result);
});

/* ========================= BOT ACCOUNTS (service/bot_accounts.js) ========================= */
// bot_manager's accounts straight from the database; logins are encrypted there and never sent back

router.get('/bot_accounts', db_ready, async (req, res) => {
  res.json(await bot_accounts.list(req.user?.steamid));
});

for (const [path, action] of [['add', bot_accounts.add], ['update', bot_accounts.update], ['enabled', bot_accounts.set_enabled], ['remove', bot_accounts.remove]]) {
  router.post(`/bot_accounts/${path}`, db_ready, async (req, res) => {
    const result = await action(req.body || {}, req.user?.steamid);
    res.status(result.status == 'ok' ? 200 : 400).json(result);
  });
}

/* ========================= PRICES SET BY HAND (service/manual_prices.js) ========================= */

router.get('/manual_prices', db_ready, async (req, res) => {
  res.json(await manual_prices.list());
});

router.get('/manual_prices/search', db_ready, async (req, res) => {
  res.json(await manual_prices.search(text(req.query?.q, 200)));
});

// { bp_sku, sell: { keys, ref }, buy: { keys, ref } | null, locked, list }
router.post('/manual_prices', db_ready, async (req, res) => {
  const result = await manual_prices.set(req.body, req.user?.steamid);
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

router.post('/manual_prices/lock', db_ready, async (req, res) => {
  const result = await manual_prices.lock(req.body);
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

router.post('/manual_prices/forget', db_ready, async (req, res) => {
  const result = await manual_prices.forget(req.body);
  res.status(result.status == 'ok' ? 200 : 400).json(result);
});

/* ========================= INVENTORY VALUE (service/inventory_value.js) ========================= */

// ?from=&to= (ms): the measurements in that period, the first and the last one (their difference is the profit)
router.get('/inventory_value', db_ready, async (req, res) => {
  try {
    const names = Object.fromEntries((Array.isArray(app.fp_data?.bots) ? app.fp_data.bots : []).map((b) => [String(b.steamid), b.personaname || '']));
    res.json({ status: 'ok', ...(await inventory_value.history({ from: Number(req.query.from), to: Number(req.query.to) })), bot_names: names });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

// "Measure now": at most once a minute
let measured_at = 0;
router.post('/inventory_value/measure', db_ready, async (req, res) => {
  if(Date.now() - measured_at < 60 * 1000){ return res.status(429).json({ status: 'error', message: 'Measured less than a minute ago.' }) }
  measured_at = Date.now();
  const doc = await inventory_value.snapshot();
  if(!doc){ return res.status(502).json({ status: 'error', message: `Not measured: ${inventory_value.state.error}` }) }
  res.json({ status: 'ok', t: doc.t });
});

/* ========================= FLIPS (service/flips.js) ========================= */

// ?from=&to= (ms): the copies the bots sold in that period and what they made on each
router.get('/flips', db_ready, async (req, res) => {
  try {
    const names = Object.fromEntries((Array.isArray(app.fp_data?.bots) ? app.fp_data.bots : []).map((b) => [String(b.steamid), b.personaname || '']));
    res.json({ status: 'ok', ...(await flips.stats({ from: Number(req.query.from), to: Number(req.query.to) })), bot_names: names });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

// "Check now": reads the newest saved trades at once (at most every 30 seconds)
let flips_checked_at = 0;
router.post('/flips/collect', db_ready, async (req, res) => {
  if(Date.now() - flips_checked_at < 30 * 1000){ return res.status(429).json({ status: 'error', message: 'Checked less than 30 seconds ago.' }) }
  flips_checked_at = Date.now();
  if(!(await flips.run_now())){ return res.status(502).json({ status: 'error', message: `Not checked: ${flips.state.error}` }) }
  res.json({ status: 'ok' });
});

/* ========================= USERS ========================= */

const user_fields = { _id: 0, steamid: 1, tradelink: 1, trades: 1, role: 1, firstlogin: 1, group_member: 1, giveaways: 1, wishlist: 1, email: 1 };

router.get('/users', async (req, res) => {
  const q = text(req.query.q, 100);
  let filter = {};
  if(/^\d{17}$/.test(q)){ filter = { steamid: q } }
  else if(q){
    const digits = q.replace(/[^0-9]/g, '');
    const or = [{ tradelink: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
    if(digits){ or.push({ steamid: { $regex: '^' + digits } }) }
    filter = { $or: or };
  }
  const users = await User.find(filter, user_fields).sort({ firstlogin: -1 }).limit(30).lean();
  res.json({ status: 'ok', users: users.map((u) => ({ ...u, online: app.users.has(u.steamid), wishlist: u.wishlist?.length || 0 })) });
});

router.post('/users/:steamid/role', async (req, res) => {
  const role = Number(req.body?.role);
  if(!/^\d{17}$/.test(req.params.steamid) || ![0, 1, 2, 3].includes(role)){
    return res.status(400).json({ status: 'error', message: 'Role must be 0 (banned), 1 (user), 2 (premium) or 3 (admin).' })
  }
  const user = await User.findOneAndUpdate({ steamid: req.params.steamid }, { $set: { role } }, { new: true, projection: user_fields }).lean();
  if(!user){ return res.status(404).json({ status: 'error', message: 'User not found.' }) }
  res.json({ status: 'ok', user });
});

// async errors -> JSON instead of the HTML error page
router.use((err, req, res, next) => {
  console.log(err);
  res.status(500).json({ status: 'error', message: 'Something failed.' });
});
