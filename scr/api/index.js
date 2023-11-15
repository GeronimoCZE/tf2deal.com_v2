const bodyParser = require('body-parser');
const express = require('express');
const router = express.Router();

const rateLimit = require('express-rate-limit');
const apicache = require("apicache");

const mw = require('./api_mw');
const fn = require('./api_fn');

//configure apicache 
let cache = apicache.middleware

const config = require('../config/config.json')

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: {status: "ERROR", message: "Too many requests! Try again later..."}
}); // 25 req per 60 sec

router.use(limiter)

// IP based rate limit middleware
// be aware when using input params from URL to get only the approved value!

// store user data in cookie

router.get('/trade_timeout', (req, res) => {
  if(req.user){
    const user_timeout = timeouts.find((user) => user.steamid == req.user.steamid);
    if(user_timeout == undefined){
      timeouts.push({
        steamid: req.user.steamid,
        expiration: Date.now() + (1000 * 60 * 60 * 24)
      })
      res.send('done')
    } else {
      res.send(`User ${user_timeout.steamid} is already timeouted! Expires at ${new Date(user_timeout.expiration).toLocaleString()}`)
    }
  } else {
    res.send('redirect')
  }
});

router.post('/new_trade', mw.isLogged, async (req, res) => {
  if(trade_offers.get(req.user.steamid) != undefined){ 
    res.send({status: "ERROR", message: "You already have an active trade!"})
    return false 
  }

  if(req.cookies[`td_${req.user.steamid}`].user.tradelink == ""){
    res.send({status: "ERROR", message: "TradeURL is missing!"})
    return false 
  }

  if('id' in req.cookies[`td_${req.user.steamid}`].trade_offer == false){
    const data = req.body;
    if('user' in data == false || 'site' in data == false){
      res.send({status: "ERROR", message: "Something went wrong..."})
      return false;
    }
    const tradeURL = req.cookies[`td_${req.user.steamid}`].user.tradelink
    const siteItems = []
    const siteAssets = []
    const sitePure = data.site.pure
    for(const item of data.site.items){
      let itm = item;
      itm.appid = 440;
      itm.contextid = 2;
      delete itm.description;
      delete itm.tags;
      siteItems.push(itm)
      siteAssets.push(item.assetid)
    }

    const userItems = []
    const userAssets = []
    const userPure = data.user.pure
    for(const item of data.user.items){
      let itm = { appid: 440, contextid: 2, assetid: item.assetid }
      userItems.push(itm)
      userAssets.push(item.assetid)
    }

    // ITEM PRICE CHECK

    const bots_IDs = [] // tradebots with items we will trade
    const bots = []
    let mainBot = undefined; // bot with the most space
    for(const item of data.site.items){
      if(!bots_IDs.includes(item.bot)){
        bots_IDs.push(item.bot)
      }
    }
    // item e.g.{appid: 730, contextid: 2, assetid: '123456789'}

    for(const botID of bots_IDs){
      const bot = TradeBots.find((bot) => bot.index == botID)
      if(bot != undefined){
        bots.push(bot)
        mainBot = bot
      }
    }

    // use sockets to emit trade offer changes... 
    if(mainBot != undefined){
      mainBot.sendTradeOffer(tradeURL, siteItems, sitePure, userItems, userPure)
      .then(
        function(trade_offer){
          const cookie = fn.user_cookie(req.user.steamid, req.cookies[`td_${req.user.steamid}`].user, fn.trade_offer_obj(trade_offer.id));
          res.cookie(cookie.name, cookie.value, cookie.setting).send({status: 'OK', trade_ID: trade_offer.id})
        }, 
        function(err){
          res.send({status: "ERROR", error: err})
        }
      )
    } else{
      TradeBots[0].sendTradeOffer(tradeURL, siteItems, sitePure, userItems, userPure)
      .then(
        function(trade_offer){
          const cookie = fn.user_cookie(req.user.steamid, req.cookies[`td_${req.user.steamid}`].user, fn.trade_offer_obj(trade_offer.id));
          res.cookie(cookie.name, cookie.value, cookie.setting).send({status: 'OK', trade_ID: trade_offer.id})
        }, 
        function(err){
          res.send({status: "ERROR", err: err})
        }
      )
    }
  }
  else{
    res.send({status: "ERROR"})
  }
});

router.get('/trade_info', mw.isLogged, async (req, res) => {
  const trade = trade_offers.get(req.user.steamid)
  res.send({status: 'OK', trade: trade || null})
})

router.post('/done_trade', mw.isLogged, async (req, res) => {
  try{
    const cookie = fn.user_cookie(req.user.steamid, req.cookies[`td_${req.user.steamid}`].user, {});
    res.cookie(cookie.name, cookie.value, cookie.setting).send('OK')
  } catch{ res.send('ERROR')}
})

// endpoint https://api.steamapis.com/steam/inventory/${steamid}/${appid}/${contextid}
router.use('/user', require('./routes/user'))

router.get('/skins', async (req, res) => {
  res.send( config.skins )
})

router.get('/warpaints', async (req, res) => {
  res.send( config.warpaints )
})

router.get('/unusual_effects', async (req, res) => {
  res.send( config.unusual_particles )
});

router.get('/bots/inventory', (req, res) => {
  // cache for 10 mins and update after each bot's item change! 
  // def_index = specific item (without a quality)
  const items = [];
  const pure = {
    key: 0,
    ref: 0,
    rec: 0,
    scrap: 0,
    bots: []
  }

  for (const bot of TradeBots) {
    if(bot.pure.Key != undefined){
      for(let item of bot.items){
        const Keys = Math.floor(Math.random() * (1000 - 1 + 1) + 1);
        const Refs = Math.floor(Math.random() * (60 - 1 + 1) + 1);
        item = {
          assetid: item.assetid,
          // make call to get the other params
          quality: item.quality,
          effect: item.effect, 
          effect_id: item.effect_id,
          type: item.type,
          name: item.name,
          classid: item.classid,
          keys: Keys,
          refs: Refs,
          image: item.image,
          tradable: item.tradable,
          description: item.description,
          tags: item.tags,
          bot: bot.index
        }
        items.push(item)
      }
      pure.key += bot.pure.Key.length
      pure.ref += bot.pure.Ref.length
      pure.rec += bot.pure.Rec.length
      pure.scrap += bot.pure.Scrap.length
      pure.bots.push({
        type: bot.type, id: bot.index,
        Key: bot.pure.Key.length, Ref: bot.pure.Ref.length, Rec: bot.pure.Rec.length, Scrap: bot.pure.Scrap.length
      })
    }
  }
  for (const bot of Warhouses) {
    if(bot.keys != undefined){
      pure.key.total += bot.keys
      pure.ref.total += bot.refs
    }
  }

  res.send({pure: pure, items: items})
});

router.get('/bots/:id', mw.isAdmin, (req, res) => {
  // get specific bot 
});
router.get('/bots/:id/inventory', mw.isAdmin, (req, res) => {
  // get specific bot inventory 
});
router.post('/bots', mw.isAdmin, (req, res) => {
    // add new bot
});
router.put('/bots/:id', mw.isAdmin, (req, res) => {
    // update specific bot
});

const puppeteer = require('puppeteer');
const request_client = require('request-promise-native');
const { TradeBot, Warhouse } = require('../bots/SteamBots');

router.get('/*', (req, res) => {
  res.json('This endpoint does not exist!')
})

module.exports = router;