const express = require('express');
const router = express.Router();

const SteamID = require('steamid')

const rateLimit = require('express-rate-limit');
const apicache = require("apicache");
let cache = apicache.middleware;
const fetch = require('node-fetch');
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname + '/config/', './.env') });

const func = require('../api_fn');
const rds = require('../redis')
const Pure = require('../../config/Pure.json')

const User = require('../../model/User'); // store in httpOnly cookie, update on change as well as DB
const Unusual_Effect = require('../../model/dev/_itemParticle')

const isLogged = (req, res, next) => {
  if(req.user){
    return next();
  } else {
    res.status(511).json('Missing credentials. You have to be signed in.')
  }
};

router.post('/update', isLogged, rateLimit({ windowMs: 60*60*1000, max: 5 }), async (req, res) => {
    let cookie = req.cookies[`td_${req.user.steamid}`]
    
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
            res.cookie(user_cookie.name, user_cookie.value, user_cookie.value).send({status: 'OK', message: 'Saved successfully!'})
          });
        } catch(e){ res.send({status: 'ERROR', message: 'Saving failed, try again!'}) }
      } else {
        res.send({status: 'ERROR', message: 'Please, enter your valid TradeURL!'})
      }
    }
    if(req.body['email']){
      
      let regex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
      if(req.body['email'] == 'null' || regex.test(req.body['email']) && cookie.user['email'] != req.body['email']){
        try{
          await User.updateOne(
            { steamid: req.user.steamid }, 
            { $set: { email: (req.body['email'] == 'null') ? "" : req.body['email']} }
          ).then(() => {
            cookie.user['email'] = req.body['email']
            const user_cookie = func.user_cookie(req.user.steamid, cookie.user, cookie.trade_offer)
            res.cookie(user_cookie.name, user_cookie.value, user_cookie.value).send({status: 'OK', message: 'Saved successfully!'})
          });
        } catch(e){ res.send({status: 'ERROR', message: 'Saving failed, try again!'}) }  
      } else {
        res.send({status: 'ERROR', message: 'Please, enter your valid Email!'})
      }
    }
});

async function filterInventory (req, res, jsonResponse) {
  return new Promise((resolve, reject) => {
    if(jsonResponse?.assets == undefined){
      reject()
    }

    const items = {
      pure: {    
        key: 0,
        ref: 0,
        rec: 0,
        scrap: 0
      },
      pureAssets: {key: [], ref: [], rec: [], scrap: []},

      items: []
    }

    for(let asset of jsonResponse.assets) {
      try{
        let asset_desc = jsonResponse.descriptions.find((desc) => desc.classid == asset.classid && desc.instanceid == asset.instanceid);
        if(asset_desc != undefined){
          // filter params
          delete asset.contextid;
          delete asset.amount;
          asset.name = asset_desc.name;
          asset.market_name = asset_desc.market_hash_name;
          asset.quality = asset_desc.tags.find((quality) => quality.category == 'Quality').localized_tag_name || "None";
          asset.image = asset_desc.icon_url;
          asset.tradable = asset_desc.tradable;
          asset.craftable = 1;
          asset.type = asset_desc.tags.find((type) => type.category == 'Type').localized_tag_name || "None";
          asset.keys = Math.floor(Math.random() * (50 - 1 + 1) + 1); 
          asset.refs = parseFloat(Math.floor(Math.random() * (60 - 1 + 1) + 1) + '.44'); 
          asset.description = asset_desc.descriptions; 
          asset.tags = asset_desc.tags;

          if( asset_desc.descriptions.find((obj) => obj.value == '( Not Usable in Crafting )') != undefined ){
            asset.craftable = 0;
          }

          // { value: '( Not Usable in Crafting )' }

          /* 
            { value: '(Kills: 0)', color: '756b5e' },
            { value: '(Assists: 0)', color: '756b5e' },
            { value: 'Paint Color: After Eight', color: '756b5e' },
            {
              value: 'Halloween: Sinister Staining (spell only active during event)',
              color: '7ea9d1'
            },
          */
        }
        else{
          asset.description = []
        }
      } catch {
        asset.description = []
      }
    };
    
    items.pureAssets.key = jsonResponse.assets.filter(item => item.classid == Pure.Key.classid).map(a => a.assetid)
    items.pureAssets.ref = jsonResponse.assets.filter(item => item.classid == Pure.Ref.classid).map(a => a.assetid)
    items.pureAssets.rec = jsonResponse.assets.filter(item => item.classid == Pure.Rec.classid).map(a => a.assetid)
    items.pureAssets.scrap = jsonResponse.assets.filter(item => item.classid == Pure.Scrap.classid).map(a => a.assetid)

    items.pure.key = items.pureAssets.key.length
    items.pure.ref = items.pureAssets.ref.length
    items.pure.rec = items.pureAssets.rec.length
    items.pure.scrap = items.pureAssets.scrap.length
    
    // -> removes all Pure and untradable items
    jsonResponse.assets = jsonResponse.assets.filter(function(item) {
      return item.tradable === 1 && item.classid !== Pure.Key.classid && item.classid !== Pure.Ref.classid && item.classid !== Pure.Rec.classid && item.classid !== Pure.Scrap.classid;
    });

    items.items = jsonResponse.assets;

    resolve(items)
  })
}

router.post('/inventory', isLogged, rateLimit({ windowMs: 10*60*1000, max: 2 }), async (req, res) => {
  let steamid = '76561198036272372'
  fetch(`https://api.steamapis.com/steam/inventory/${req.user.steamid}/440/2?api_key=${process.env.API_KEY_STEAM_APIS}`)
  .then((res) => {  
    return res.json() 
  })
  .then( (jsonResponse) => {
    filterInventory( req, res, jsonResponse )
      .then(
        function(items){
          res.send(items)
        }, 
        function(err){
          res.send('error')
        }
      )
  })
  .catch(err => {
    res.send('error')
  });
      
})

module.exports = router;