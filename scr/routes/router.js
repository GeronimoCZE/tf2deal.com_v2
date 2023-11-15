const fn = require('../fn')

const home = (req, res) => {
    if(req.user){
        const user_cookie = req.cookies[`td_${req.user.steamid}`];
        res.render('home', fn.res_data(true, req.user, user_cookie, 'Home', {view: 'home'}))
    } 
    else {
        res.render('home', fn.res_data(false, req.user, undefined, 'Home', {view: 'home'}))
    }
}

const trade = (req, res) => {
    if(req.user){
        const user_cookie = req.cookies[`td_${req.user.steamid}`];
        let user_timeout = timeouts.find((user) => user.steamid == req.user.steamid);
    
        if(user_timeout == undefined){
          if(user_cookie != undefined){
            if('id' in user_cookie.trade_offer == false){
              res.render('trade', fn.res_data(true, req.user, user_cookie, 'Trade', {view: 'trade'}))
            }
            else{
              res.render('trade_created', fn.res_data(true, req.user, user_cookie, 'Trade', {view: 'trade_created'}))
            }
          }
          else{
            res.render('trade', fn.res_data(true, req.user, user_cookie, 'Trade', {view: 'trade'}))
          }
        } else {
          if(user_timeout.expiration <= Date.now()){
            const index = timeouts.findIndex(obj => obj.steamid == req.user.steamid)
            timeouts.splice(index,1)
            res.redirect(req.url)
          } else {
            res.render('trade_timeout', fn.res_data(true, req.user, user_cookie, 'Trade', {view: 'trade_timeout', timeout: user_timeout}))
          }
        }
      } 
    else {
        res.render('trade', fn.res_data(false, req.user, undefined, 'Trade', {view: 'trade'}))
    }
}

const items = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    let user_timeout = timeouts.find((user) => user.steamid == req.user.steamid);

    if(user_timeout == undefined){
      if(user_cookie != undefined){
        if('id' in user_cookie.trade_offer == false){
          res.render('items', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'items'}))
        }
        else{
          res.render('trade_created', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'trade_created'}))
        }
      }
      else{
        res.render('items', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'items'}))
      }
    } else {
      if(user_timeout.expiration <= Date.now()){
        const index = timeouts.findIndex(obj => obj.steamid == req.user.steamid)
        timeouts.splice(index,1)
        res.redirect(req.url)
      } else {
        res.render('trade_timeout', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'trade_timeout', timeout: user_timeout}))
      }
    }
  } 
  else {
    res.render('items', fn.res_data(false, req.user, undefined, 'Items', {view: 'items'}))
  }
}

const item_page = (req, res) => {
  console.log(req.params.item)
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    let user_timeout = timeouts.find((user) => user.steamid == req.user.steamid);

    if(user_timeout == undefined){
      if(user_cookie != undefined){
        if(user_cookie.trade_offer.length == undefined){
          res.render('item_page', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'item_page'}))
        }
        else{
          res.render('trade_created', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'trade_created'}))
        }
      }
      else{
        res.render('item_page', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'item_page'}))
      }
    } else {
      if(user_timeout.expiration <= Date.now()){
        const index = timeouts.findIndex(obj => obj.steamid == req.user.steamid)
        timeouts.splice(index,1)
        res.redirect(req.url)
      } else {
        res.render('trade_timeout', fn.res_data(true, req.user, user_cookie, 'Items', {view: 'trade_timeout', timeout: user_timeout}))
      }
    }
  } 
  else {
    res.render('item_page', fn.res_data(false, req.user, undefined, 'Items', {view: 'item_page'}))
  }
  /* fallback pricing = 2 types of item look-ups (1. specific item, 2. item type - firm price) */
}

const giveaway = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('giveaway', fn.res_data(true, req.user, user_cookie, 'Giveaway', {view: 'giveaway'}))
  } else {
    res.render('giveaway', fn.res_data(false, req.user, undefined, 'Giveaway', {view: 'giveaway'}))
  }
}

const about = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('about', fn.res_data(true, req.user, user_cookie, 'About', {view: 'about', bots: {TradeBots, OfflineBots}}))
  } else {
    res.render('about', fn.res_data(false, req.user, undefined, 'About', {view: 'about', bots: {TradeBots, OfflineBots}}))
  }
}

const premium = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('premium', fn.res_data(true, req.user, user_cookie, 'premium', {view: 'premium'}))
  } else {
    res.render('premium', fn.res_data(false, req.user, undefined, 'premium', {view: 'premium'}))
  }
}

const help = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('help', fn.res_data(true, req.user, user_cookie, 'Help', {view: 'help'}))
  } else {
    res.render('help', fn.res_data(false, req.user, undefined, 'Help', {view: 'help'}))
  }
}

const terms_of_service = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('terms_of_service', fn.res_data(true, req.user, user_cookie, 'TOS', {view: 'tos'}))
  } else {
    res.render('terms_of_service', fn.res_data(false, req.user, undefined, 'TOS', {view: 'tos'}))
  }
}

const blog = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('blog', fn.res_data(true, req.user, user_cookie, 'Blog', {view: 'blog'}))
  } else {
    res.render('blog', fn.res_data(false, req.user, undefined, 'Blog', {view: 'blog'}))
  }
}

const create_ticket = (req, res) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('create-ticket', fn.res_data(true, req.user, user_cookie, 'create_ticket', {view: 'create_ticket'}))
  } else {
    res.render('create-ticket', fn.res_data(false, req.user, undefined, 'create_ticket', {view: 'create_ticket'}))
  }
}

module.exports = {
    home, trade, items, item_page, giveaway, about,
    premium, blog,
    help, terms_of_service, create_ticket
}