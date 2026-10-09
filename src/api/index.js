import bodyParser from 'body-parser';
import * as express from 'express';
import rateLimit from 'express-rate-limit';
import * as apicache from 'apicache'
import mongoose from "mongoose";
import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'

import * as app from '../app.js'
import * as mw from './api_mw.js'

import {effect_model} from '../model/Effect.js'
import {skin_model} from '../model/Skin.js'
import {warpaint_model} from '../model/Warpaint.js'
import {trade_model} from '../model/Trade.js'
import {rating_model} from '../model/Rating.js'

import {router as userApi} from './routes/user.js'
import {router as itemApi} from './routes/items.js'
import {router as adminApi} from './routes/admin.js'
import * as settings from '../service/settings.js'
import * as notifications from '../service/notifications.js'
import UserModel from '../model/User.js'
import { log } from 'console';

export const router = express.Router();

// Express 4 doesn't catch errors thrown in async handlers (one bad request could stop the whole server),
// so every handler's promise is passed on to the error handler at the bottom.
for (const method of ['get', 'post']) {
  const register = router[method].bind(router);
  router[method] = (path, ...handlers) => register(path, ...handlers.map((handler) => (req, res, next) => {
    try { return Promise.resolve(handler(req, res, next)).catch(next) } catch (error) { next(error) }
  }));
}


//configure apicache 
let cache = apicache.middleware

const inv_limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 70,
  message: (req) => ({status: "error", message: req.__ ? req.__('api.too_many_requests') : "Too many requests! Try again later..."})
}); // 25 req per 60 sec
const item_limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 70,
  message: (req) => ({status: "error", message: req.__ ? req.__('api.too_many_requests') : "Too many requests! Try again later..."})
}); // 25 req per 60 sec


router.use('/user', userApi)
router.use('/items', itemApi)
router.use('/admin', adminApi)

let bot_cache = []
const latest_trades_cache = { data: [], timestamp: 0 }

router.get('/item_names', (req, res) => {
  let data = [];

  for (const file of fs.readdirSync(path.join(process.cwd(), '/src/api/data'))) {
    if (file.startsWith('item_names') && file.endsWith('.txt')) {
      const fileData = fs.readFileSync(path.join(process.cwd(), '/src/api/data/', file), 'utf8');
      data = [...data, ...fileData.split(',')];
    }
  }

  res.send({item_names: [...data]})
});


router.get('/latest_trades', async (req, res) => {
    if(Date.now() - latest_trades_cache.timestamp < 10 * 1000){
      res.json({trades: latest_trades_cache.data})  
    } else {
      await trade_model.find({}, { _id: 0, toGive: 1, toReceive: 1, timestamp: 1, key_value: 1 }).sort({timestamp: -1}).limit(5).lean().then((trades) => {
          latest_trades_cache.data = trades;
          latest_trades_cache.timestamp = Date.now();
          res.json({trades: trades})
      }).catch((e) => {
        res.status(500).json({status: 'error', message: 'failed to fetch latest trades'})
      })
    }
});

router.get('/bots', (req, res) => {
  res.json({bots: app.fp_data.bots})
});

/* Notifications for the bell in the nav (service/notifications.js). Signed-in users only: the ones for everyone
   plus their own; "seen" is saved on their account. */
const notif_limiter = rateLimit({ windowMs: 60 * 1000, max: 30 })

router.get('/notifications', mw.isLogged, notif_limiter, async (req, res) => {
  try {
    const steamid = req.user.steamid
    const [items, seen] = await Promise.all([notifications.list(steamid), notifications.seen_at(steamid)])
    res.set('Cache-Control', 'no-store')
    res.json({ status: 'ok', items, seen })
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Server error' })
  }
});

router.post('/notifications/seen', mw.isLogged, notif_limiter, async (req, res) => {
  try {
    res.json({ status: 'ok', seen: await notifications.mark_seen(req.user.steamid) })
  } catch (error) {
    res.status(500).json({ status: 'error' })
  }
});

router.post('/new_bot', mw.isLogged, mw.isAdmin, async(req, res) => {
  
});

router.post('/bots/inventory', inv_limiter, (req, res) => {
  try {
    const filters = req.body.filters
    if(filters == undefined || typeof filters !== 'object'){ 
      res.status(500).json({status: 'error', message: 'missing headers'}); return false;
    }
    else if(filters?.quality === undefined || filters?.type === undefined || filters?.particle === undefined || !Object.hasOwn(filters, 'item-order')  || filters?.price === undefined || filters?.search === undefined || typeof filters?.page != 'number'){
      res.status(500).json({status: 'error', message: 'missing headers'}); return false;
    }

    if(!req.user && filters.page > 2){
      res.json({error: 'error'})
      return;
    }
  
    filters["classes"] = filters["class"]   
    filters["order"] = filters["item-order"]
    delete filters["item-order"]
    delete filters["class"]

    // only plain values (text, numbers, true/false, or lists of them) go on to the bot server, so nobody can
    // slip in database operators like {"$ne": null}
    const plain = (v) => ['string', 'number', 'boolean'].includes(typeof v) || v === null
    for (const [name, value] of Object.entries(filters)) {
      if(name.startsWith('$') || !(plain(value) || (Array.isArray(value) && value.length <= 50 && value.every(plain)))){ delete filters[name] }
    }

    fetch(process.env.BOTS_ENDPOINT + '/inventory', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer YOUR_TOKEN"
      },
      body: JSON.stringify({
        admin_password: process.env.ADMIN_PASSWORD,
        pass: process.env.PASSWORD,
        filters: filters
      })
    })
      .then((res) => {
        return res.json()
      })
      .then((data) => {
          res.json(data)
      })
      .catch((e) => {
        console.log(e)
        res.json({error: 'error'})
      })
  } catch (error) {
     console.log(error)
    res.json({error: 'error'})
  }
});

router.post('/bots/inventory/:bp_sku', inv_limiter, (req, res) => {
  if(req.body?.inventory == undefined){ res.status(500).json({status: "error", message: "unathorized request"}); return false; }
  
    fetch(process.env.BOTS_ENDPOINT + '/inventory/single', {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_TOKEN"
          },
          body: JSON.stringify({
            admin_password: process.env.ADMIN_PASSWORD,
            pass: process.env.PASSWORD,
            bp_sku: (typeof req.body.bp_sku == 'string' ? req.body.bp_sku : String(req.params.bp_sku)).slice(0, 300)
          })
        })
      .then((response) => {
        return response.json() 
      })
      .then((response) => {
        console.log(response);
        
        if(response?.success == 1){
          res.status(200).json(response)
        } else {
          res.status(200).json(response);
          console.log('error')
        }
      })
      .catch((e) => {
          res.status(500).json({status: "error", message: req.__('api.item_server_unreachable')});
      })
});


const trade_limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  keyGenerator: (req) => req.user?.steamid ? `u:${req.user.steamid}` : req.ip,
  message: (req) => ({status: "error", message: req.__ ? req.__('api.too_many_requests') : "Too many requests! Try again later..."})
});
router.post('/create_trade', mw.isLogged, trade_limiter, async (req, res) => {
  const {User, Site, key, partner_steamid, single_item} = req.body;

  // live site settings (admin panel / /settings socket)
  if(!settings.trading_enabled()){
    return res.status(503).json({ success: 0, status: "error", message: req.__('api.trading_paused') })
  }
  const blacklisted = [...(Array.isArray(User?.items) ? User.items : []), ...(Array.isArray(Site?.items) ? Site.items : [])]
    .find((item) => settings.is_blacklisted(item?.bp_sku))
  if(blacklisted){
    return res.status(400).json({ success: 0, status: "error", message: req.__('api.item_blacklisted', { name: blacklisted.bp_sku }) })
  }

  // banned in the admin panel (Users -> role 0)
  const account = process.db_status?.connected ? await UserModel.findOne({ steamid: req.user?.steamid }, { role: 1 }).lean().catch(() => null) : null
  if(account?.role === 0){
    return res.status(403).json({ success: 0, status: "error", message: req.__('api.account_blocked') })
  }

  try {
    if(typeof User == "object" && typeof Site == "object" && typeof key == "object"){
      if(req.user?.hash?.hex && User?.hash === req.user.hash.hex && Site?.hash === req.user.hash.hex && req.user?.steamid){

        // the trade URL saved on the account (the cookie copy can be edited in the browser)
        const saved = process.db_status?.connected ? await UserModel.findOne({ steamid: String(req.user.steamid) }, { tradelink: 1 }).lean().catch(() => null) : null
        const tradeURL = saved ? (saved.tradelink || null) : (req.cookies[`td_${req.user.steamid}`]?.user?.tradelink || null);

        if(!tradeURL || tradeURL == 'null' || tradeURL == ""){
          res.status(500).json({ status: "error", message: req.__('api.missing_trade_url') })
          return;
        }

        const data = {
          pass: process.env.PASSWORD,
          admin_password: process.env.ADMIN_PASSWORD,
          data: { User: User, Site: Site, partner_steamid: String(req.user.steamid), tradeurl: tradeURL, single_item: single_item === true }
        }
  
        console.log('sending trade request to bot server', data.data)


        let respon = false
  
        fetch(process.env.BOTS_ENDPOINT + '/trade', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              "Authorization": "Bearer ",
              "Accept": "*/*",
          },
          body: JSON.stringify(data),
        })
          .then((response) => {
            return response.json()
          })
          .then((response) => {
              if(!respon){
                  respon = true;
                  if(response?.success == 1){               
                    
                    res.status(200).json(response)
                  } else {
                    res.status(200).json({ success: 0, message: response?.message || response?.error || req.__('api.trade_failed') })
                  }
              }
          })
          .catch((e) => {
            if(!respon){
              respon = true;
              res.status(500).json({ status: "error", message: req.__('api.bot_server_unreachable') })
            }
          })
      } else {
        res.status(500).json({ status: "error", message: "unauthorized request" })
      }
    } else {
      res.status(500).json({ status: "error", message: "missing input" })
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: req.__('api.trade_failed') })
    return;
  }
});

router.get('/key', async (req, res) => {
  res.send( 'ok' )
})

router.get('/skins', async (req, res) => {
  res.send( 'ok' )
})

router.get('/warpaints', async (req, res) => {
  res.send( 'ok' )
})

router.get('/warpaints_all', async (req, res) => {
  res.json({warpaints: await warpaint_model.find({}), skins: await skin_model.find({})})
})

/* Star rating after an accepted trade (trade offer modal, js/plugins/trade.js -> rating box).
   Body: { stars: 1-5, comment?: text (500), offer_id?: steam offer id, trustpilot?: true when they opened Trustpilot }
   Rating the same offer again (e.g. adding a comment) updates it. */
const rating_limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: (req) => ({status: "error", message: req.__ ? req.__('api.too_many_requests') : "Too many requests! Try again later..."})
});
router.post('/rating', mw.isLogged, rating_limiter, async (req, res) => {
  if(!settings.get().reviews.enabled){ return res.status(403).json({ status: 'error', message: 'Ratings are turned off.' }) }
  if(process.db_status?.connected !== true){ return res.status(503).json({ status: 'error', message: 'Please try again in a moment.' }) }

  const plain = (v) => (typeof v == 'string' || typeof v == 'number') ? v : undefined // objects could crash Number()/String()
  const stars = Number(plain(req.body?.stars))
  if(!Number.isInteger(stars) || stars < 1 || stars > 5){ return res.status(400).json({ status: 'error', message: 'stars must be a whole number from 1 to 5.' }) }
  const comment = typeof req.body?.comment == 'string' ? req.body.comment.trim().slice(0, 500) : undefined
  const offer_id = /^\d{1,20}$/.test(String(plain(req.body?.offer_id) ?? '')) ? String(req.body.offer_id) : ''
  const steamid = String(req.user.steamid)
  const now = Date.now()

  // without an offer id, a new rating within 10 minutes replaces the previous one
  const filter = offer_id ? { steamid, offer_id } : { steamid, offer_id: '', created: { $gte: now - 10 * 60 * 1000 } }
  const verified = !!(await trade_model.exists({ partnerSteamID: steamid }).catch(() => null))
  const $set = { stars, updated: now, name: req.user.personaname || '', verified, lang: req.lang || res.locals?.lang || 'en' }
  if(comment !== undefined){ $set.comment = comment }
  if(req.body?.trustpilot === true){ $set.trustpilot = true }

  await rating_model.findOneAndUpdate(filter, { $set, $setOnInsert: { steamid, offer_id, created: now } }, { upsert: true, new: true })
  res.json({ status: 'ok' })
});

router.get('/unusual_effects', async (req, res) => {
  res.json(await effect_model.find({}))
});

router.use((req, res, next) => {
  res.status(400).send({ status: "error", message: "invalid request" })
})

router.use((err, req, res, next) => {
  console.error('api error', req.method, req.originalUrl, err?.message)
  if (res.headersSent) { return }
  res.status(500).json({ status: "error", message: "Server error" })
})
