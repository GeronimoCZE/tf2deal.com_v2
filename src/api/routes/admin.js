import express from 'express';
import mongoose from 'mongoose';

import * as fn from '../../fn.js'
import { item_model } from '../../model/Item.js';
import { blog_model } from '../../model/Blog.js';
import { ticket_model } from '../../model/Ticket.js';
import { giveaway_model } from '../../model/Giveaway.js';
import User from '../../model/User.js';
import { refresh_state, draw_winner } from '../../service/giveaway.js';
import * as translate from '../../service/translate.js';
import { LANGS, LANG_NAMES } from '../../i18n.js';
import { trade_model } from '../../model/Trade.js';
import { rating_model } from '../../model/Rating.js';
import * as settings from '../../service/settings.js';
import * as season from '../../service/season.js';
import * as notifications from '../../service/notifications.js';
import * as stock_limits from '../../service/stock_limits.js';
import { notification_model } from '../../model/Notification.js';
import { clients as settings_clients } from '../../service/settings_socket.js';
import { bot_socket, item_socket } from '../../service/socket.js';
import * as app from '../../app.js';
import { has_admin_session } from '../../mw.js';

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

const blog_fields = (body) => ({
  title: text(body?.title, 150),
  slug: fn.slugify(text(body?.slug, 100) || text(body?.title, 150)),
  cover: text(body?.cover, 500),
  excerpt: text(body?.excerpt, 300),
  content: text(body?.content, 50000),
  published: body?.published === true || body?.published === 'true',
  lang: LANGS.includes(body?.lang) ? body.lang : 'en' // the language the post is written in
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

router.post('/blog/preview', (req, res) => {
  res.json({ status: 'ok', html: fn.render_markdown(text(req.body?.content, 50000)) });
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
  if(post.published){ translate.queue_post(post._id) }
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
  res.json({ status: 'ok', translation: translation_info(), post: with_translation(post) });
});

router.post('/blog/:id/delete', valid_id, async (req, res) => {
  await blog_model.deleteOne({ _id: req.params.id });
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

router.get('/giveaways', async (req, res) => {
  const giveaways = await giveaway_model.find({}).sort({ created: -1 }).limit(50).lean();

  const winner_ids = giveaways.map((g) => g.winner?.steamid).filter(Boolean);
  const winners = await User.find({ steamid: { $in: winner_ids } }, { steamid: 1, tradelink: 1 }).lean();

  res.json({ status: 'ok', giveaways: giveaways.map((g) => ({
    ...g,
    entries: undefined,
    entry_count: g.entries?.length || 0,
    winner_tradelink: winners.find((u) => u.steamid == g.winner?.steamid)?.tradelink || ''
  })) });
});

router.post('/giveaways', async (req, res) => {
  const bp_sku = text(req.body?.bp_sku, 200);
  const end = Number(req.body?.end);

  if(await giveaway_model.exists({ status: 'active' })){
    return res.status(400).json({ status: 'error', message: 'End the current giveaway before starting a new one.' })
  }
  if(!(end > Date.now() + 60 * 1000)){
    return res.status(400).json({ status: 'error', message: 'The end date has to be in the future.' })
  }
  const item = await item_model.findOne({ bp_sku }, { _id: 0, bp_sku: 1, image: 1, qualityID: 1, effectID: 1 }).lean();
  if(!item){
    return res.status(400).json({ status: 'error', message: `No item called "${bp_sku}" in the item database.` })
  }

  const now = Date.now();
  const giveaway = await new giveaway_model({
    item: { bp_sku: item.bp_sku, image: item.image, qualityID: String(item.qualityID ?? '6'), effectID: Number(item.effectID) || 0 },
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
  if(giveaway.description){
    await giveaway_model.updateOne({ _id: giveaway._id }, { $set: { source_hash: translate.source_hash(giveaway, translate.GIVEAWAY_FIELDS) } });
    translate.queue_giveaway(giveaway._id);
  }

  await refresh_state();
  notifications.notify({ type: 'giveaway_new', vars: { item: item.bp_sku }, link: '/giveaway' });
  res.json({ status: 'ok', giveaway });
});

router.post('/giveaways/:id/end', valid_id, async (req, res) => {
  const giveaway = await giveaway_model.findOne({ _id: req.params.id, status: 'active' }).lean();
  if(!giveaway){ return res.status(404).json({ status: 'error', message: 'No active giveaway with this id.' }) }
  const winner = await draw_winner(giveaway);
  await refresh_state();
  res.json({ status: 'ok', winner });
});

router.post('/giveaways/:id/cancel', valid_id, async (req, res) => {
  await giveaway_model.updateOne({ _id: req.params.id, status: 'active' }, { $set: { status: 'cancelled', end: Date.now() } });
  await refresh_state();
  res.json({ status: 'ok' });
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

router.get('/overview', async (req, res) => {
  const day_ago = Date.now() - 24 * 60 * 60 * 1000;
  const db = process.db_status?.connected === true;
  const count = (promise) => db ? promise.catch(() => null) : Promise.resolve(null);

  const [users_total, users_new, trades_day, tickets_open, giveaway, rating] = await Promise.all([
    count(User.estimatedDocumentCount()),
    count(User.countDocuments({ firstlogin: { $gte: day_ago } })),
    // trade timestamps may be in ms or in seconds
    count(trade_model.countDocuments({ $or: [{ timestamp: { $gte: day_ago } }, { timestamp: { $gte: Math.floor(day_ago / 1000), $lt: 1e11 } }] })),
    count(ticket_model.countDocuments({ status: 'open' })),
    db ? giveaway_model.findOne({ status: 'active' }, { item: 1, end: 1, entries: 1 }).lean().catch(() => null) : null,
    db ? rating_summary().catch(() => null) : null
  ]);

  const online = Array.from(app.users.values());
  res.json({ status: 'ok', overview: {
    db,
    uptime: Math.round(process.uptime()),
    bot_server: bot_socket.socket ? 'online' : 'offline',
    item_server: item_socket.socket ? 'online' : 'offline',
    bots: Array.isArray(app.fp_data.bots) ? app.fp_data.bots.length : 0,
    items: Number(app.fp_data.items) || 0,
    trades_reported: Number(app.fp_data.trades) || 0,
    key_price: app.key_price?.metal ?? null,
    users_online: online.length,
    users_trading: online.filter((u) => u.trade).length,
    users_total, users_new, trades_day, tickets_open,
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
