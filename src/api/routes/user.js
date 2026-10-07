import express from 'express';
import SteamID from 'steamid';
import rateLimit from 'express-rate-limit';
import apicache from 'apicache';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import * as app from '../../app.js'
import { bot_socket, item_socket } from '../../service/socket.js';

import * as func from '../api_fn.js';

import mongoose from 'mongoose';

import User from '../../model/User.js';
import { inventory_model } from '../../model/Inventory.js';
import { trade_model } from '../../model/Trade.js';
import { item_model } from '../../model/Item.js';
import { ticket_model } from '../../model/Ticket.js';
import { giveaway_model } from '../../model/Giveaway.js';
import { check_requirements } from '../../service/giveaway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, './config/.env') });

export const router = express.Router();

// Express 4 doesn't catch errors thrown in async handlers (one bad request could stop the whole server),
// so every handler's promise is passed on to the error handler at the bottom.
for (const method of ['get', 'post']) {
  const register = router[method].bind(router);
  router[method] = (path, ...handlers) => register(path, ...handlers.map((handler) => (req, res, next) => {
    try { return Promise.resolve(handler(req, res, next)).catch(next) } catch (error) { next(error) }
  }));
}

const cache = apicache.middleware;

const inv_limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  message: (req) => ({status: "error", message: req.__ ? req.__('api.too_many_requests') : "Too many requests! Try again later..."})
}); // 25 req per 60 sec

const isLogged = (req, res, next) => {
  if(req.user){
    return next();
  } else {
    res.status(511).json(req.__('api.sign_in_required'))
  }
};

router.post('/update', isLogged, rateLimit({ windowMs: 60*60*1000, max: 6 }), async (req, res) => {
    let cookie = req.cookies[`td_${req.user.steamid}`]
    if(!cookie || typeof cookie != 'object' || typeof cookie.user != 'object' || cookie.user === null){
      return res.status(400).send({status: 'ERROR', message: req.__('api.save_failed')})
    }
    // only plain text is accepted (an object here used to crash the server)
    for (const field of ['tradeurl', 'email']) {
      if(req.body[field] !== undefined && typeof req.body[field] != 'string'){
        return res.status(400).send({status: 'ERROR', message: req.__(field == 'email' ? 'api.invalid_email' : 'api.invalid_trade_url')})
      }
    }
    
    if(req.body['tradeurl']){
      const accountid = new SteamID(req.user.steamid).accountid;
      if( 
          req.body['tradeurl'] == 'null' || 70 < req.body['tradeurl'].length && 80 > req.body['tradeurl'].length && 
          req.body['tradeurl'].includes(`?partner=${accountid}`) && req.body['tradeurl'].includes(`&token`) &&
          cookie.user['tradelink'] != req.body['tradeurl']
      ){
        try{
          await User.updateOne(
            { steamid: req.user.steamid }, 
            { $set: { tradelink: (req.body['tradeurl'] == 'null') ? "":req.body['tradeurl']} }
          ).then(() => {
            cookie.user['tradelink'] = req.body['tradeurl']
            const user_cookie = func.user_cookie(req.user.steamid, cookie.user, cookie.trade_offer)
            res.cookie(user_cookie.name, user_cookie.value, user_cookie.setting).send({status: 'OK', message: req.__('api.saved')})
          });
        } catch(e){ res.send({status: 'ERROR', message: req.__('api.save_failed')}) }
      } else {
        res.send({status: 'ERROR', message: req.__('api.invalid_trade_url')})
      }
    }
    if(req.body['email']){
      
      // simple check without nested repeats (the old pattern could freeze the server on long input)
      const regex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
      if(req.body['email'] == 'null' || req.body['email'].length <= 254 && regex.test(req.body['email']) && cookie.user['email'] != req.body['email']){
        try{
          await User.updateOne(
            { steamid: req.user.steamid }, 
            { $set: { email: (req.body['email'] == 'null') ? "" : req.body['email']} }
          ).then(() => {
            cookie.user['email'] = req.body['email']
            const user_cookie = func.user_cookie(req.user.steamid, cookie.user, cookie.trade_offer)
            res.cookie(user_cookie.name, user_cookie.value, user_cookie.setting).send({status: 'OK', message: req.__('api.saved')})
          });
        } catch(e){ res.send({status: 'ERROR', message: req.__('api.save_failed')}) }  
      } else {
        res.send({status: 'ERROR', message: req.__('api.invalid_email')})
      }
    }
});

router.post('/add_wishlist', isLogged, rateLimit({ windowMs: 60*60*1000, max: 10 }), async (req, res) => {
  const {bp_sku} = req.body
  const user_cookie = req.cookies[`td_${req.user.steamid}`]?.user;

  if(typeof bp_sku != "string"){
    res.status(500).json({status: 'error', message: ''})
    return;
  }

  // update cookie if user using multiple sessions

  try{
    let wishlisted = false
    let limit = true;
    if(user_cookie?.wishlist){
      if(user_cookie.wishlist.length < 10){
        limit = false;
      }
      if(user_cookie.wishlist.includes(bp_sku)){
        wishlisted = true
      }
    }
    
    if(!wishlisted && !limit){
        await User.updateOne(
          { steamid: req.user.steamid },
          { $addToSet: { wishlist: bp_sku } },
          { new: true }
        ).then(() => {
          user_cookie.wishlist.push(bp_sku)

          const cookie = func.user_cookie(req.user.steamid, user_cookie, req.cookies[`td_${req.user.steamid}`]?.trade_offer)
          res.cookie(cookie.name, cookie.value, cookie.setting).send({status: 'ok', message: req.__('api.saved')})  
        })
        .catch(() => {
          res.status(500).json({status: 'error', message: req.__('api.save_failed')})
        });
    } else {
      res.status(500).json({status: 'error', message: req.__('api.already_wishlisted')})
    }
  } catch(e){ 
    console.log(e)
    res.status(500).json({status: 'error', message: req.__('api.save_failed')})
  } 
})

router.post('/remove_wishlist', isLogged, rateLimit({ windowMs: 60*60*1000, max: 10 }), async (req, res) => {
  const {bp_sku} = req.body
  const user_cookie = req.cookies[`td_${req.user.steamid}`]?.user;

  try {
    if(typeof bp_sku != "string"){
      res.status(500).json({status: 'error', message: ''})
      return;
    }
  
    await User.updateOne(
      { steamid: req.user.steamid },
      {
        $pull: { wishlist: bp_sku },
      },
      { new: true }
    );
  
    const index = user_cookie.wishlist.indexOf(bp_sku);

    if (index !== -1) {
      user_cookie.wishlist.splice(index, 1);
    }

    const cookie = func.user_cookie(req.user.steamid, user_cookie, req.cookies[`td_${req.user.steamid}`]?.trade_offer)
    res.cookie(cookie.name, cookie.value, cookie.setting).send({status: 'ok', message: req.__('api.saved')})
  } catch (error) {
    res.status(500).json({status: 'error', message: req.__('api.save_failed')})
  }
})

router.post('/inventory', isLogged, inv_limiter, async (req, res) => {
  const filters = req.body.filters
    if(filters == undefined || typeof filters !== 'object'){ 
      res.status(500).json({status: 'error', message: 'missing headers'}); return false;
    }
    else if(filters?.quality === undefined || filters?.type === undefined || filters?.particle === undefined || !Object.hasOwn(filters, 'item-order')  || filters?.price === undefined || filters?.search === undefined || typeof filters?.page != 'number'){
      res.status(500).json({status: 'error', message: 'missing headers'}); return false;
    }

    if(!req.user){
      res.json({error: 'error'})
      return;
    }
  
    filters["classes"] = filters["class"]   
    filters["order"] = filters["item-order"]
    delete filters["item-order"]
    delete filters["class"]

  if(req.body?.inventory == undefined){ res.status(500).json({status: "error", message: "unathorized request"}); return false; }

  if(!bot_socket.socket){
    res.status(500).json({status: "error", message: req.__('api.trading_unavailable')});
    return false;
  }
  /* if(require('../../app').global_stock_limits.data.length == 0){
    res.status(500).json({status: "error", message: req.__('api.item_server_unreachable')});
    return false;
  } */

  const steamid = req.user.steamid;
  let res_sent = false;
  try{
    fetch(process.env.BOTS_ENDPOINT + '/inventory/user', {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_TOKEN"
          },
          body: JSON.stringify({
            admin_password: process.env.ADMIN_PASSWORD,
            pass: process.env.PASSWORD,
            filters: filters,
            steamid: steamid
          })
        })
      .then((response) => {
        return response.json() 
      })
      .then((response) => {
        console.log(response);
        
        res_sent = true;
        if(response?.success == 1){
          if(app.users.has(steamid)){
            app.users.set(steamid, { ...app.users.get(steamid), trade: true }) // keep the user's open tabs
          }
          res.status(200).json(response)
        } else {
          res.status(200).json(response);
          console.log('error')
        }
      })
      .catch((e) => {
        if(!res_sent){
          console.log('error catch')
          res.status(500).json({status: "error", message: req.__('api.item_server_unreachable')});
        }
      })
  } catch(error) {
    console.log('error trycatch', error)
    res.status(500).json({status: "error", message: req.__('api.item_server_unreachable')});
  }
})

router.post('/inventory/:bp_sku', isLogged, inv_limiter, async (req, res) => {
  if(req.body?.inventory == undefined){ res.status(500).json({status: "error", message: "unathorized request"}); return false; }

  if(!bot_socket.socket){
    res.status(500).json({status: "error", message: req.__('api.trading_unavailable')});
    return false;
  }

  const steamid = req.user.steamid;
  let res_sent = false;
  
  try{
    fetch(process.env.BOTS_ENDPOINT + '/inventory/user/single', {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_TOKEN"
          },
          body: JSON.stringify({
            admin_password: process.env.ADMIN_PASSWORD,
            pass: process.env.PASSWORD,
            bp_sku: req.params.bp_sku,
            steamid: steamid
          })
        })
      .then((response) => {
        return response.json() 
      })
      .then((response) => {
        console.log(response);
        
        res_sent = true;
        if(response?.success == 1){
          if(app.users.has(steamid)){
            app.users.set(steamid, { ...app.users.get(steamid), trade: true }) // keep the user's open tabs
          }
          res.status(200).json(response)
        } else {
          res.status(200).json(response);
          console.log('error')
        }
      })
      .catch((e) => {
        if(!res_sent){
          console.log('error catch')
          res.status(500).json({status: "error", message: req.__('api.item_server_unreachable')});
        }
      })
  } catch(error) {
    console.log('error trycatch', error)
    res.status(500).json({status: "error", message: req.__('api.item_server_unreachable')});
  }
})

/* ========================= PROFILE ========================= */

const PAGE_SIZE = 10

router.get('/trades', isLogged, async (req, res) => {
  const page = Math.max(0, parseInt(req.query.page) || 0)
  try {
    const trades = await trade_model.find({ partnerSteamID: req.user.steamid })
      .sort({ timestamp: -1 }).skip(page * PAGE_SIZE).limit(PAGE_SIZE + 1).lean()
    res.json({ status: 'ok', trades: trades.slice(0, PAGE_SIZE), more: trades.length > PAGE_SIZE })
  } catch (error) {
    res.status(500).json({ status: 'error', message: req.__('api.load_trades_failed') })
  }
})

router.get('/wishlist', isLogged, async (req, res) => {
  try {
    const user = await User.findOne({ steamid: req.user.steamid }, { wishlist: 1 }).lean()
    const wishlist = user?.wishlist || []
    const items = await item_model.find(
      { bp_sku: { $in: wishlist } },
      { _id: 0, bp_sku: 1, image: 1, qualityID: 1, effectID: 1, sell: 1, buy: 1, status: 1, stock: 1, bptf_data: 1 }
    ).lean()

    // keep the order they were added in; items that left the database still show (without a price)
    res.json({ status: 'ok', items: wishlist.map((sku) => items.find((item) => item.bp_sku == sku) || { bp_sku: sku, missing: true }) })
  } catch (error) {
    res.status(500).json({ status: 'error', message: req.__('api.load_wishlist_failed') })
  }
})

/* ========================= GIVEAWAYS ========================= */

router.get('/giveaways', isLogged, async (req, res) => {
  const steamid = req.user.steamid
  try {
    const giveaways = await giveaway_model.find({ 'entries.steamid': steamid }, { entries: 0 }).sort({ end: -1 }).limit(50).lean()
    res.json({ status: 'ok', giveaways: giveaways.map((g) => ({
      id: g._id,
      item: g.item,
      start: g.start,
      end: g.end,
      status: g.status,
      won: g.winner?.steamid == steamid,
      prize_sent: g.prize_sent,
      winner: g.winner?.steamid ? g.winner.name : null
    })) })
  } catch (error) {
    res.status(500).json({ status: 'error', message: req.__('api.load_giveaways_failed') })
  }
})

const REQUIREMENT_MESSAGES = {
  steam_group: { false: 'api.gw_join_group', null: 'api.gw_group_unknown' },
  trade: { false: 'api.gw_need_trade' }
}

router.post('/giveaway/enter', isLogged, rateLimit({ windowMs: 60*60*1000, max: 20 }), async (req, res) => {
  const steamid = req.user.steamid
  try {
    const giveaway = await giveaway_model.findOne({ status: 'active', end: { $gt: Date.now() } }, { entries: 0 }).lean()
    if(!giveaway){
      return res.json({ status: 'error', message: req.__('api.gw_none') })
    }

    if(await giveaway_model.exists({ _id: giveaway._id, 'entries.steamid': steamid })){
      return res.json({ status: 'ok', entered: true, already: true, message: req.__('api.gw_already') })
    }

    const requirements = await check_requirements(steamid, giveaway)
    if(!requirements.ok){
      const message = Object.entries(REQUIREMENT_MESSAGES)
        .filter(([key]) => requirements[key] !== undefined && requirements[key] !== true)
        .map(([key, texts]) => req.__(texts[String(requirements[key])]))
        .join(' ')
      return res.json({ status: 'error', requirements, message })
    }

    const result = await giveaway_model.updateOne(
      { _id: giveaway._id, status: 'active', 'entries.steamid': { $ne: steamid } },
      { $push: { entries: { steamid, name: req.user.personaname || '', avatar: req.user.avatarmedium || '', entered: Date.now() } } }
    )
    if((result.nModified ?? result.modifiedCount) > 0){
      await User.updateOne({ steamid }, { $inc: { 'giveaways.entries': 1 } })
    }

    res.json({ status: 'ok', entered: true, requirements, message: req.__('api.gw_entered') })
  } catch (error) {
    console.log(error)
    res.status(500).json({ status: 'error', message: req.__('api.gw_failed') })
  }
})

/* ========================= SUPPORT TICKETS ========================= */

const TICKET_TITLES = ['Login Issue', 'Trade Issue', 'Bug Report', 'Feature Request', 'Other']
const TICKET_TEXT_LIMIT = 2000
const OPEN_TICKET_LIMIT = 3

const ticket_json = (ticket) => ({
  id: ticket._id,
  title: ticket.title,
  status: ticket.status,
  messages: ticket.messages,
  created: ticket.created,
  updated: ticket.updated
})

router.get('/tickets', isLogged, async (req, res) => {
  try {
    const tickets = await ticket_model.find({ steamid: req.user.steamid }).sort({ updated: -1 }).limit(50).lean()
    res.json({ status: 'ok', tickets: tickets.map(ticket_json) })
  } catch (error) {
    res.status(500).json({ status: 'error', message: req.__('api.load_tickets_failed') })
  }
})

router.post('/tickets', isLogged, rateLimit({ windowMs: 60*60*1000, max: 5 }), async (req, res) => {
  const title = req.body?.title
  const details = (typeof req.body?.details == 'string') ? req.body.details.trim() : ''

  if(!TICKET_TITLES.includes(title)){
    return res.status(400).json({ status: 'error', message: req.__('api.ticket_pick_topic') })
  }
  if(details.length > TICKET_TEXT_LIMIT){
    return res.status(400).json({ status: 'error', message: req.__('api.ticket_too_long', { max: TICKET_TEXT_LIMIT }) })
  }

  try {
    const open = await ticket_model.countDocuments({ steamid: req.user.steamid, status: { $ne: 'closed' } })
    if(open >= OPEN_TICKET_LIMIT){
      return res.status(400).json({ status: 'error', message: req.__('api.ticket_too_many', { count: open }) })
    }

    const now = Date.now()
    const ticket = await new ticket_model({
      steamid: req.user.steamid,
      name: req.user.personaname || '',
      title,
      status: 'open',
      messages: [{ from: 'user', text: details || title, created: now }],
      created: now,
      updated: now
    }).save()

    res.json({ status: 'ok', ticket: ticket_json(ticket) })
  } catch (error) {
    res.status(500).json({ status: 'error', message: req.__('api.ticket_create_failed') })
  }
})

router.post('/tickets/:id/reply', isLogged, rateLimit({ windowMs: 60*60*1000, max: 30 }), async (req, res) => {
  const text = (typeof req.body?.text == 'string') ? req.body.text.trim() : ''
  if(!mongoose.Types.ObjectId.isValid(req.params.id)){ return res.status(404).json({ status: 'error', message: req.__('api.ticket_not_found') }) }
  if(text.length == 0 || text.length > TICKET_TEXT_LIMIT){
    return res.status(400).json({ status: 'error', message: req.__('api.ticket_reply_length', { max: TICKET_TEXT_LIMIT }) })
  }

  try {
    const now = Date.now()
    const ticket = await ticket_model.findOneAndUpdate(
      { _id: req.params.id, steamid: req.user.steamid, status: { $ne: 'closed' } },
      { $push: { messages: { from: 'user', text, created: now } }, $set: { status: 'open', updated: now } },
      { new: true }
    ).lean()
    if(!ticket){ return res.status(404).json({ status: 'error', message: req.__('api.ticket_closed') }) }
    res.json({ status: 'ok', ticket: ticket_json(ticket) })
  } catch (error) {
    res.status(500).json({ status: 'error', message: req.__('api.ticket_reply_failed') })
  }
})

router.post('/tickets/:id/close', isLogged, async (req, res) => {
  if(!mongoose.Types.ObjectId.isValid(req.params.id)){ return res.status(404).json({ status: 'error', message: req.__('api.ticket_not_found') }) }
  try {
    const ticket = await ticket_model.findOneAndUpdate(
      { _id: req.params.id, steamid: req.user.steamid },
      { $set: { status: 'closed', updated: Date.now() } },
      { new: true }
    ).lean()
    if(!ticket){ return res.status(404).json({ status: 'error', message: req.__('api.ticket_not_found') }) }
    res.json({ status: 'ok', ticket: ticket_json(ticket) })
  } catch (error) {
    res.status(500).json({ status: 'error', message: req.__('api.ticket_close_failed') })
  }
})

router.use((err, req, res, next) => {
  console.error('api error', req.method, req.originalUrl, err?.message)
  if (res.headersSent) { return }
  res.status(500).json({ status: "error", message: "Server error" })
})
