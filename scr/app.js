const DOMAIN = 'localhost' // 192.168.0.161
const PORT = 3000; // change to 8080

const express = require('express');
const app = express();
const http = require('http');
const server = http.Server(app);
const cors = require('cors');
const url = require('url')

app.use(cors({
  origin: [`http://${DOMAIN}:${PORT}`, `http://tf2deal.com`, `https://tf2deal.com/`, `https://dark-astronaut-263999.postman.co/`],
  methods: ['GET','POST','DELETE','UPDATE','PUT','PATCH'],
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}))

const path = require("path");
const passport = require('passport');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const socket = require('socket.io');
const io = socket(server);

const EventEmitter = require('events')

const SteamStrategy = require('passport-steam').Strategy;
const TradeOfferManager = require('steam-tradeoffer-manager');
const manager = new TradeOfferManager ({
	language: 'en'
});
const SteamTotp = require('steam-totp')

const fetch = require('node-fetch');

const mongoose = require('mongoose');
const { nextTick, env } = require('process');

const csrf = require('csurf')

const Pure = require('./config/Pure.json')

require('dotenv').config({ path: path.resolve(__dirname + '/config/', './.env') });

app.use( bodyParser.json({limit: '50mb'}) );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true,
  limit: '50mb'
})); 
app.use(express.json());       // to support JSON-encoded bodies
app.use(express.urlencoded({
  extended: true
})); // to support URL-encoded bodies

app.set('views', path.join(__dirname, '/view'));
app.use(bodyParser.urlencoded({ extended: true })); 
app.use('/public',express.static(path.join(__dirname,'static')));
app.use(express.static(__dirname + '/public'));
app.set('view engine','ejs');
app.set('trust proxy', false)

passport.serializeUser((user, done) => {
	done(null, user._json);
});

passport.deserializeUser((obj, done) => {
	done(null, obj);
});

passport.use(new SteamStrategy({ // change to tf2deal.com!
	returnURL: `http://${DOMAIN}:${PORT}/auth/steam/return`
	, realm: `http://${DOMAIN}:${PORT}/`
	, apiKey: process.env.API_KEY_STEAM
}, (identifier, profile, done) => {
  return done(null, profile);
}));
app.use(cookieParser());
app.use(session({
	key: 'session_id'
	, secret: 'id'
	, resave: false
	, saveUninitialized: true
	, cookie: {
		  maxAge: 12*60*60*1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(
  session({
    secret: 'thisisasecret',
    saveUninitialized: false,
    resave: false
  })
);

Date.prototype.toUnixTime = function() { return this.getTime()/1000|0 };
Date.time = function() { return new Date().toUnixTime(); }

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DB_CONNECTION, 
      {useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true},
      () => {
        console.log('connected to DB')
        fn.setup_cache()
        fn.update_pure()
      }
    );
  } catch (err) {
    console.log('Failed to connected to DB')
  }
}
connectDB()

const User = require('./model/User')

const fn = require('./fn')
const mw = require('./mw')
const router = require('./routes/router')

global.users = new Map();
global.tradesToday = 0;
global.itemsAvailable = 0;
global.botsRunning = 0;

global.key_price = {metal: 0, usd: '2.20'};

// status (ok/bad), in_use = active usage e.g. item updates (avoiding beiing rate limited)
global.api = {
    backpack_tf: { status: 'bad', update: Date.now(), in_use: false },
    steam_apis: { status: 'bad', update: Date.now(), in_use: false }
}

global.timeouts = [];
global.trade_offers = new Map(); // on restart load from bots
global.tradeStatus = ''; // Warning: Trading might not work at the moment

/* BACKPACK.TF API

IGetPrices (price scheme)
  = https://backpack.tf/api/IGetPrices/v4?raw=1&key=60466698e25954308c7f678b
  
Search
  = https://backpack.tf/api/classifieds/search/v1?item_names=1&page=2&item=Tough%20Stuff%20Muffs&tradable=1&craftable=1&australium=-1&killstreak_tier=0&key=60466698e25954308c7f678b
  - painted items includes attribute [{"defindex":142,"value":*paint defindex*,"float_value":*paint defindex*}]

*/

const update_server = () => {
  // update trade_offers (get from bots)
} 

update_server()
// run everyday at midnight


// remove sockets - use GET calls
io.on('connection', socket => {
  io.emit('userchange', users.size);

  socket.on('init', (steam_user) => {
    socket.Steam_User = steam_user
    if(socket.Steam_User != 'no_session' && socket.Steam_User != undefined){
      if(users.get(socket.Steam_User) == undefined){
        users.set(socket.Steam_User, 1) 
      } else {
        users.set(socket.Steam_User, users.get(socket.Steam_User) + 1)
        if(users.get(socket.Steam_User) > 2){
          socket.disconnect(true)
        } 
      }
    }

    
    socket.on('get_tradeOffer', async (steamid) => {
      const tradeOffer = trade_offers.get(steamid)
      socket.emit('tradeOffer', tradeOffer)
    })

    socket.on("getKeyPrice", () => {
      socket.emit('keyPrice', {key_price: key_price, key_price_$: key_price_$});
    })
  })

  socket.on("getSiteData", () => {  
    /* Array.from(io.sockets.sockets, function (entry) {
      return { key: entry[0], value: entry[1] };
    }) */

    socket.emit('siteData', {onlineUsers: users.size,tradesToday: tradesToday, itemsAvailable: itemsAvailable, botsRunning: botsRunning});
  })

  socket.on("disconnect", () => {
    if(socket.Steam_User != 'no_session'){
      users.set(socket.Steam_User, users.get(socket.Steam_User) - 1)
      if(users.get(socket.Steam_User) == 0){
        users.delete(socket.Steam_User)
      }
    }
    io.emit('userchange', users);
  })
}); 

const rateLimit = require('express-rate-limit')
const view_limiter = rateLimit({
  windowMs: 100 * 1000,
  max: 150,
  message: "You are beeing rate limited (for 1 hour). You have made too many requests.",
  validate: {ip: false}
}); 
const item_limiter = rateLimit({
  windowMs: 100 * 1000,
  max: 150,
  message: "You are beeing rate limited (for 1 hour). You have made too many requests.",
  validate: {ip: false}
}); 

app.get('/', view_limiter, mw.curPath, router.home);
app.get('/trade', view_limiter, mw.curPath, router.trade);
app.get('/items', item_limiter, mw.curPath, router.items);
app.get('/items/:item', item_limiter, mw.curPath, router.item_page);
app.get('/giveaway', view_limiter, mw.curPath, router.giveaway); // only premium users can entry
app.get('/about', view_limiter, mw.curPath, router.about);

app.get('/terms-of-service', view_limiter, mw.curPath, router.terms_of_service);
//app.get('/create-ticket', view_limiter, mw.isLogged, router.create_ticket);
app.get('/premium', view_limiter, mw.curPath, router.premium); // garantees a giveaway ticket... Pay 1 key / Put tf2deal.com or tf2deal in Steam name 
app.get('/blog', view_limiter, mw.curPath, router.blog);

app.use('/profile', view_limiter, mw.curPath, require('./routes/profile'))
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./api'));

app.get('/get_userDB_', mw.isLogged, async (req, res) => {
  if(req.cookies[`td_${req.user.steamid}`] == undefined ){
    update_cookie(req, res)
  } 
  else {
    if(req.cookies[`td_${req.user.steamid}`].hasOwnProperty('update')){
      if(Number(req.cookies[`td_${req.user.steamid}`].update) > Date.now()){
        if(trade_offers.get(req.user.steamid) != undefined){
          const cookie = fn.user_cookie(req.user.steamid, req.cookies[`td_${req.user.steamid}`].user, {id: trade_offers.get(req.user.steamid).id})
          res.cookie(cookie.name, cookie.value, cookie.setting).redirect(req.cookies['td_current_url'] || '/trade')
        } else {
          res.redirect(req.cookies['td_current_url'] || '/trade')
        }
      } else {
        update_cookie(req, res)
      }
    } else {
      update_cookie(req, res)
    }
  }

  async function update_cookie(req, res){
    let user = await User.findOne({steamid: req.user.steamid})

    if(user == null){
      let saveUser = new User({
        steamid: req.user.steamid,
        firstlogin: Date.now()
      })

      try {
        saveUser.save().then(() => {
          const tradeOffer = (trade_offers.get(req.user.steamid) == undefined) ? {}:{id: trade_offers.get(req.user.steamid).id}
          const cookie = fn.user_cookie(req.user.steamid, saveUser, tradeOffer)
          res.cookie(cookie.name, cookie.value, cookie.setting).redirect("/profile?new_user=true")
        })
      } catch {
        res.redirect('/logout?login_error=true')
      }
    } else {
      const tradeOffer = (trade_offers.get(req.user.steamid) == undefined) ? {}:{id: trade_offers.get(req.user.steamid).id}
      const cookie = fn.user_cookie(req.user.steamid, user, tradeOffer)
      res.cookie(cookie.name, cookie.value, cookie.setting).redirect(req.cookies['td_current_url'] || '/trade')
    }
  }
})

app.get(/^\/auth\/steam(\/return)?$/, passport.authenticate('steam', {
  failureRedirect: '/',
}), (req, res) => {
  res.redirect('/get_userDB_');
});

app.get('/logout', (req, res) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    let login_error = (req.query['login_error'] == 'true') ? '?login_error=true':'' 
    res.redirect('/' + login_error);
  });
});

/* handling wrong paths */
app.use(view_limiter, (req, res, next) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.status(404).render('404', fn.res_data(true, req.user, user_cookie, '404'))
  } else {
    res.status(404).render('404', fn.res_data(false, req.user, undefined, '404'))
  }
})

const SteamBots = require('./bots/SteamBots');
// const Bots = require('./model/Bot');
const Bots = [
  {id: 1, type: 'trade', name: 'storebot77', password: 'storebot', sharedSecret: 'Fl39iW5oQm5m3vDHu58PndPikOY=', identitySecret: 'IwNHkFaOh/GWWwikZXBL+QJfA1U=', "disableMobile": true},
  {id: 2, type: 'trade', name: 'tdbot1', password: 'thisisspirit', sharedSecret: '6OeSjhqY2RcTOoPc76ja9epZbBE=', identitySecret: '7wcacRP7UEYvtMO1jGAtGglcC98=', "disableMobile": true},
  {id: 3, type: 'trade', name: 'tdbot2_', password: 'thisisspirit', sharedSecret: 'g5pH1qcy/Cc2ltZryAayMM3GGfs=', identitySecret: '68liPx5Ndej3WRVLrGfc6GlNxQc=', "disableMobile": true},
  {id: 4, type: 'trade', name: 'tdbot3', password: 'thisisspirit', sharedSecret: 'Rg6CYLs04u02jipDjJ6QPEC2Jlo=', identitySecret: 'CoDOB5LboacI3CyN850nYm/UcYM=', "disableMobile": true},
  {id: 1, type: 'warhouse', name: 'tdwarhouse1', password: 'thisisspirit', sharedSecret: '79FoYQJsN3iiz5BSO/5Bdlp/zAs=', identitySecret: 'ERmQpnYKWNYQawW9xV4Wwpa+ubA=', "disableMobile": true}
]

global.BotsSteamIDs = []

global.TradeBots = []
global.Warhouses = []

global.OfflineBots = []

const moveBot_ = async (new_status, bot, bot_type) => {
  const steam_bot = bot;
  if(new_status == 'logged'){
    if(OfflineBots.find((bot) => bot.index == steam_bot.index && bot.type == steam_bot.type) != undefined){
      const index = OfflineBots.findIndex(bot => bot.index == steam_bot.index && bot.type == steam_bot.type)
      OfflineBots.splice(index,1)
    }
    switch (bot_type) {
      case 'trade':
        if(TradeBots.find((bot) => bot.index == steam_bot.index) == undefined){
          TradeBots.push(bot)
          botsRunning += 1
        }
        break;
      case 'warhouse':
        if(Warhouses.find((bot) => bot.index == steam_bot.index) == undefined){
          Warhouses.push(bot)
          botsRunning += 1
        }
        break;
      default:
        break;
    }
  }
  else if(new_status == 'offline'){
    // remove if exist in logged arr
    switch (bot_type) {
      case 'trade':
        if(TradeBots.find((bot) => bot.index == steam_bot.index) != undefined){
          const index = TradeBots.findIndex(bot => bot.index == steam_bot.index)
          TradeBots.splice(index,1)
        }
        break;
      case 'warhouse':
        if(Warhouses.find((bot) => bot.index == steam_bot.index) != undefined){
          const index = Warhouses.findIndex(bot => bot.index == steam_bot.index)
          Warhouses.splice(index,1)
        }
        break;
      default:
        break;
    }
    // dont push if exist in offline arr
    if(OfflineBots.find((bot) => bot.index == steam_bot.index && bot.type == steam_bot.type) == undefined){
      OfflineBots.push(bot)
      if(botsRunning > 0){
        botsRunning -= 1
      }
    }
  }
}

/* 
"Invalid": 1,
	"Active": 2,            // This trade offer has been sent, neither party has acted on it yet.
	"Accepted": 3,          // The trade offer was accepted by the recipient and items were exchanged.
	"Countered": 4,         // The recipient made a counter offer
	"Expired": 5,           // The trade offer was not accepted before the expiration date
	"Canceled": 6,          // The sender cancelled the offer
	"Declined": 7,          // The recipient declined the offer
	"InvalidItems": 8,      // Some of the items in the offer are no longer available (indicated by the missing flag in the output)
	"CreatedNeedsConfirmation": 9, // The offer hasn't been sent yet and is awaiting further confirmation
	"CanceledBySecondFactor": 10, // Either party canceled the offer via email/mobile confirmation
	"InEscrow": 11,          // The trade has been placed on hold
*/


// GET TIMECREATION OF ACCOUNT
// http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=822B9C17E98DD8C57532F14A33507B4B&steamids=76561198124728984

const runBot = async (Bot) => {
  // creates "bot" instance and assign event listeners (DO NOT REINITIATE, RUN SEP FCE TO RELOG!)
  const bot = (Bot.type == "trade") ? new SteamBots.TradeBot({
    accountName: Bot.name,
    password: Bot.password,
    twoFactorCode: SteamTotp.generateAuthCode(Bot.sharedSecret),
    identitySecret: Bot.identitySecret,
    sharedSecret: Bot.sharedSecret,
    accountID: Bot.id,
    accountType: Bot.type
  })
  : new SteamBots.Warhouse({
    accountID: Bot.id,
    accountName: Bot.name,
    password: Bot.password,
    twoFactorCode: SteamTotp.generateAuthCode(Bot.sharedSecret),
    identitySecret: Bot.identitySecret,
    sharedSecret: Bot.sharedSecret,
    accountID: Bot.id,
    accountType: Bot.type
  })

  bot.on('steamGuard', () => {
    moveBot_('offline', bot, Bot.type)
  })
  bot.on('offline', () => {
    moveBot_('offline', bot, Bot.type)
  })
  bot.on('logged', () => {
    moveBot_('logged', bot, Bot.type)
  })
  bot.on('tradeOfferChange', async(offerID, state, steam_user) => {

    const tradeOffer = trade_offers.get(steam_user)
    if(tradeOffer == undefined){ return false }
    if(tradeOffer.id != offerID){ return false }
    tradeOffer.state = state

    if(state == 2){ tradeOffer.willCanceled = Date.now() + 600000 }

    const sockets = Array.from(io.sockets.sockets, function (entry) {
      return entry[1];
    })
    let userSockets = sockets.filter(obj => obj.Steam_User == steam_user);
    if(userSockets.length > 0){
      userSockets.forEach(async(socket) => {
        socket.emit('tradeChange', state)
      });
    }
    if([3,4,5,6,7,8,10,11].includes(state)){
      tradeOffer.remove()
    }
  })
  bot.on('err', (EName) => { // use to communicate with bots in real-time
    if(EName == "AcceptFriend"){
      
    }
  })
}

const run_Bots = async () => {
  for (const Bot of Bots) {
    runBot(Bot)
  }
  // done
};

run_Bots();

let date = new Date().getDate();
setInterval(() => {
  if(date != new Date().getDate()){
    date = new Date().getDate()
    console.log(`... ${new Date().getDate()} / ${new Date().getMonth() + 1} / ${new Date().getFullYear()} ...`)
  }
}, 1*60*1000);

setInterval(async () => {
  tradesToday = 0

  await fn.update_pure()
  
}, 24 * 3600000);


/* 
  these packages need keep up to the latest version!

    "steam-tradeoffer-manager": "^2.10.6",
    "steam-user": "^4.29.3",
    "steamcommunity": "^3.47.0"
*/

server.listen(process.env.PORT || PORT, () => console.log(`running on URL localhost:${PORT}`));

