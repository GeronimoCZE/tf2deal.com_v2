import express from 'express'
import dotenv from 'dotenv';
import dns from 'dns'
import http from 'http'
import cors from 'cors'
import path from 'path'
import url from 'url'
import passport from 'passport'
import SteamStrategy from 'passport-steam';
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import mongoose from 'mongoose'
import rateLimit from 'express-rate-limit'
import apicache from 'apicache'
import compression from 'compression'
import fetch from 'node-fetch'
import csrf from 'csurf'
import EventEmitter from 'events'
import { promisify } from 'util'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { LRUCache } from 'lru-cache'
import { Server as SocketIOServer } from 'socket.io'

import {router as api} from './api/index.js'
import {router as profileRoute} from './routes/profile.js'

import { bot_socket, createSocket, item_socket } from './service/socket.js'

const DOMAIN = 'localhost' 
const PORT = 8080; // change to 8080
let season = "winter";

const app = express()
const server = http.createServer(app)

const io = new SocketIOServer(server, {
  maxHttpBufferSize: 5e6, // 5 MB per message (was 100 MB, before anyone is even signed in)
  pingTimeout: 60000
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, "config/.env") });

const reverseLookup = promisify(dns.reverse);

// Cache for tracking rate-limiting events and restrictions
const userLimitCache = {};
// Cache for bot DNS lookup results (IP-based) to avoid repeated lookups
const botIpCache = new LRUCache({
  maxSize: 500, // Cache up to 500 bot IPs
  ttl: 1000 * 60 * 60 * 24 * 7, // Cache for 7 days
  sizeCalculation: () => 1,
});

// Rate limit parameters
const RATE_LIMIT_COUNT = 5; // Number of allowed rate limits
const RATE_LIMIT_PERIOD = 1000 * 60 * 60 * 24 * 7; // 1 week in milliseconds

// Major crawler user agents and corresponding hostnames
const knownBots = {
  google: { userAgent: 'Googlebot', hostname: 'googlebot.com' },
  bing: { userAgent: 'Bingbot', hostname: 'search.msn.com' },
  yandex: { userAgent: 'YandexBot', hostname: 'yandex.com' },
  baidu: { userAgent: 'Baiduspider', hostname: 'baidu.com' },
  duckduckgo: { userAgent: 'DuckDuckBot', hostname: 'duckduckgo.com' }
};

// Middleware to check if the IP belongs to a known bot using cached DNS reverse lookup
async function isBotIp(userAgent, ip) {
  const cachedBotCheck = botIpCache.get(ip);
  if (cachedBotCheck !== undefined) {
    return cachedBotCheck; // Return the cached result (true or false)
  }

  const matchingBot = Object.values(knownBots).find(bot => userAgent.includes(bot.userAgent));

  if (!matchingBot) {
    botIpCache.set(ip, false); // Cache as false for non-bot IPs
    return false;
  }

  try {
    const hostnames = await reverseLookup(ip); // Perform DNS reverse lookup
    const isValidBot = hostnames.some(hostname => hostname.endsWith(matchingBot.hostname));

    // Cache the result (true if valid bot, false otherwise)
    botIpCache.set(ip, isValidBot);
    return isValidBot;
  } catch (error) {
    console.error(`DNS lookup failed for IP: ${ip}`, error);
    botIpCache.set(ip, false); // Cache as false on error
    return false;
  }
}

// Function to check if the user is restricted
function isUserRestricted(userId) {
  return userLimitCache[userId]?.restricted || false;
}

// Middleware to skip the rate limiter for known bots
async function shouldSkipRateLimit(req) {
  const userAgent = req.get('User-Agent');
  const ip = req.ip;
  
  // Check if the request comes from a known bot
  return await isBotIp(userAgent, ip);
}

// Middleware to check user access (if restricted after 5 violations)
async function checkAccess(req, res, next) {
  const userId = req.ip;

  if (isUserRestricted(userId)) {
    return res.status(403).json({ message: 'Access denied. You have been rate limited.' });
  }

  next();
}

// Function to log rate-limited events
function logRateLimit(userId) {
  const now = Date.now();
  const userEntry = userLimitCache[userId] || { count: 0, timestamps: [] };

  // Remove timestamps older than the rate limit period
  userEntry.timestamps = userEntry.timestamps.filter(timestamp => (now - timestamp) < RATE_LIMIT_PERIOD);

  // Increment count and add the current timestamp
  userEntry.count += 1;
  userEntry.timestamps.push(now);

  // Check if the user exceeded the allowed rate limits
  if (userEntry.count >= RATE_LIMIT_COUNT) {
    userEntry.restricted = true; // Mark user as restricted
  }

  userLimitCache[userId] = userEntry; // Update cache
}

const allRequestsLimiter = rateLimit({
  windowMs: 16 * 60 * 60 * 1000,
  max: 43500,
  message: {
    status: 429,
    error: 'Too many requests',
    details: 'You have exceeded the rate limit. You can try again in 16 hours since you exceeded the limit.',
  },
  skip: shouldSkipRateLimit, // Skip the rate limit for known bots
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  headers: true,
}); 

/* handling wrong paths */
app.use(compression()) // gzip responses
app.use(allRequestsLimiter)
app.use(checkAccess);


app.use(cors({
  origin: [`https://tf2deal.com/`, `https://backpack.tf/`],
  methods: ['GET','POST','DELETE','UPDATE','PUT','PATCH'],
  credentials: true,
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}))

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// a failed promise somewhere is logged instead of stopping the whole site
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason?.message || reason))

import localEmitter from './emitter.js'
import { log, profile } from 'console'

/*
app.use(function(req, res, next) {
if (req.secure) {
res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
res.set("Content-Security-Policy", "default-src 'self'");
}
next();
})
*/

// Basic security headers on every response (no CSP: the pages use inline scripts)
app.disable('x-powered-by')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (String(process.env.SITE_URL || '').startsWith('https://')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

app.use( bodyParser.json({limit: '1mb'}) );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: false, // plain key=value only: no nested objects like password[$ne]=x
  limit: '1mb'
})); 

app.set('views', path.join(__dirname, '/view'));
app.use(express.static(path.join(__dirname,'public')));

app.locals.site_url = fn.site_url
Object.assign(app.locals, i18n.default_locals) // English for pages rendered before the language middleware
app.set('view engine','ejs');
// Behind Nginx or Cloudflare, set TRUST_PROXY in .env (1 = Nginx only, 2 = Cloudflare + Nginx) so the rate limits
// see each visitor's own IP instead of the proxy's (otherwise everyone shares one limit).
const trust_proxy = String(process.env.TRUST_PROXY || '').trim()
app.set('trust proxy', /^\d+$/.test(trust_proxy) ? Number(trust_proxy) : false)

// 1. Setup serialization
passport.serializeUser((user, done) => {
  done(null, user._json);
});
passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// 2. Use the Steam strategy
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`; // set SITE_URL=https://tf2deal.com in .env for production
passport.use(new SteamStrategy({
  returnURL: `${SITE_URL}/auth/steam/return`,
  realm: SITE_URL,
  apiKey: process.env.API_KEY_STEAM
}, (identifier, profile, done) => {
  return done(null, profile);
}));

// 3. Middleware setup — only one session!
// SESSION_SECRET signs the login cookie. Without it, a random one is made at start (everyone is signed out
// on restart), never a fixed default that anyone could use to forge a login.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.warn('SESSION_SECRET is missing or shorter than 32 characters in .env; using a random one until restart.')
}
const SESSION_SECRET = (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) ? process.env.SESSION_SECRET : crypto.randomBytes(48).toString('hex')

app.use(cookieParser());
const sessionMiddleware = session({
  key: 'session_id',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto', // Secure flag whenever the request came over https
    maxAge: 12 * 60 * 60 * 1000 // 12 hours
  }
});
app.use(sessionMiddleware);

// 4. Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// The browser socket gets the same session, so "who is this" comes from the signed-in session and not from
// whatever steamid the page sends (service/socket.js)
io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

// 5. Language (/de/..., /cs/... -> see i18n.js), then SEO data for the page
app.use(i18n.middleware)
app.use((req, res, next) => {
  const page_path = fn.clean_path(req.path)
  res.locals.page_path = page_path
  res.locals.canonical = fn.canonical_url(page_path, req.lang)
  // account/admin/trade-offer pages are kept out of search results
  res.locals.noindex = /^\/(profile|admin|login|support|buy|auth|logout|get_userDB_)(\/|$)/.test(page_path)
  next()
})

// app.use() use global ratelimit (1 hour / xxxx req)

Date.prototype.toUnixTime = function() { return this.getTime()/1000|0 };
Date.time = function() { return new Date().toUnixTime(); }

process.db_status = { connected: false } ;
const bots_state = {
  trading: false,
  ready: 0,
  total: 0
}

export const fp_data = {
  items: NaN,
  trades: NaN,
  bots: []
}

export const key_price = {metal: null, usd: null, updated: 0};

import { trade_model } from './model/Trade.js';


const connectDB = async () => {
  try {
    mongoose.connect(process.env.DB_CONNECTION, 
      {useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true, server: {
        socketOptions: {
          socketTimeoutMS: 0,
          connectionTimeout: 0
        }
      }},
      async(err) => {
        if (err) {
          console.log('Failed to connect to DB:', err.message)
          return
        }
        console.log('connected to DB')
        fn.setup_cache();
        settings.load().catch((e) => console.log('Failed to load site settings', e.message));
        fn.update_sitemap();
        giveaways.refresh_state().catch((e) => console.log('Failed to load giveaways', e.message));
        translate.sweep().catch((e) => console.log('translate: start failed', e.message)); // AI translations still missing

        item_model.createIndexes({ bp_sku: 1 }).then(() => {
          console.log('Item model indexes created successfully.');
        }).catch((error) => {
          console.error('Error creating Item model indexes:', error);
        });

        trade_model.createIndexes({ partnerSteamID: 1, timestamp: -1 }).then(() => {
          console.log('Trade model indexes created successfully.');
        }).catch((error) => {
          console.error('Error creating Trade model indexes:', error);
        });

        await pure_model.findOne({name: "Mann Co. Supply Crate Key"}).then((pure) => {
          if(pure){
            key_price.metal = pure.value_raw;
            key_price.updated = Date.now();
          }        
        }).catch(() => {
          console.log('Failed to get pure value from DB')
        })
      }
    );
  } catch (err) {
    console.log('Failed to connected to DB')
  }
  
  async function findMatchingMarketItems() {
    try {
      fetch(new URL(`https://api.steamapis.com/market/items/440?api_key=${process.env.API_KEY_STEAM_APIS}`))
        .then((res) => {  
          return res.json()
        })
        .then(async (jsonResponse) => {
          const marketItems = jsonResponse?.data || []

          const steamSkuSet = new Map(); // Using a Set for fast lookups
          const operations = []
  
          console.log("Fetching documents using cursor...");
      
          // Step 1: Use a cursor to process documents in chunks
          const cursor = Instance.find({}, { steam_sku: 1, _id: 0 }).lean().cursor();
      
          for await (const doc of cursor) {
            if (doc.steam_sku) {
              const obj = await marketItems.find(i => i.market_hash_name == doc?.steam_sku)
              if(obj && !steamSkuSet.has(doc?.steam_sku)){
                steamSkuSet.set(doc.steam_sku, obj?.nameID ? obj.nameID:'false');
                operations.push({ updateMany: {
                  filter: { steam_sku: doc?.steam_sku },
                  update: { $set: { "nameid": obj?.nameID ? obj.nameID:'false' } }
                } })
              }
            }
          }
      
          console.log(`Extracted ${steamSkuSet.size} unique steam_sku values.`);

          Instance.bulkWrite(operations).then((res) => {
            console.log(`Updated all nameids`);
          }).catch((e) => {
            console.log(e);
          })
        })
    } catch (error) {
      console.error('Error processing documents:', error);
    }
  }

  // findMatchingMarketItems()

  function handleError(mongoError) {
    // check error reason, increment counters, check if errors limit reached
    console.log(mongoError)
  }
  mongoose.connection.on('error', handleError);

  mongoose.connection.on('disconnected', () => { process.db_status = { connected: false } ;});
  mongoose.connection.on('reconnected', () => { process.db_status = { connected: true } });
  mongoose.connection.on('connected', () => { process.db_status = { connected: true } });
}

const isItemserver = (handshake) => {
  if(handshake != undefined){
    if(handshake?.query?.server == 'item_servercdxd' && same_secret(handshake?.auth?.server_token, process.env.SERVER_TOKEN) && same_secret(handshake?.auth?.server_secret, process.env.SERVER_SECRET)){
      return true;
    } else {
      return false
    }
  } else {
    return false;
  }
}

const isBotserver = (handshake) => {
  if(handshake != undefined){
    if(handshake?.query?.server == 'bot_serverxdcd' && same_secret(handshake?.auth?.server_token, process.env.SERVER_TOKEN) && same_secret(handshake?.auth?.server_secret, process.env.SERVER_SECRET)){
      return true;
    } else {
      return false
    }
  } else {
    return false;
  }
}

const site_inventory = {
  time: Date.now(),
  status: "offline",
  bots: []
}

// if bot_server disconnects for more then 10 mins reset site_inventory and get bot inventories again

const user_sockets = new Map()
const trade_states = {
  "1": "error",
  "2": "sent",
  "3": "accepted",
  "4": "declined counter",
  "5": "declined expired",
  "6": "error wrong offer",
  "7": "declined",
  "8": "error missing items",
  "9": "pending",
  "10": "declined",
  "11": "declined trade hold"
}

global.key_price = {metal: 0, usd: '2.20'};

const global_stock_limits = {
  updated: 0,
  data: ["4"]
}

export { io, global_stock_limits }
const bptf_api = { status: false }

import User from './model/User.js'

import * as fn from './fn.js'
import * as mw from './mw.js'
import * as router from './routes/router.js'
import * as giveaways from './service/giveaway.js'
import * as translate from './service/translate.js'
import * as settings from './service/settings.js'
import * as i18n from './i18n.js'
import {item_model as Instance, item_model} from '../src/model/Item.js'

const Item_Server = {
  status: "offline",
  server: {}
};
const Bot_Server = {
  status: "offline",
  server: {}
};

const users = new Map();
const activeTrades = new Map();

global.tradesToday = 0;
global.itemsAvailable = 0;
global.botsRunning = 0;

const Giveaway = {
  active: false,
  item: undefined,
  entries: [],
  end: undefined
};

// on item trasnfer update global and bot inventory!

const trade_offers = new Map(); // on restart load from bots


app.use((req, res, next) => {
  const timeout = 60000; // 60 seconds

  // Set a timeout on the response object
  res.setTimeout(timeout, () => {
    if (!res.headersSent) res.status(504).send({status: "error", message: 'Request timed out'});
  });

  next();
});

// bot list for the Bots page: asked from the bot server at most once a minute, everyone else gets the copy
const steambots_cache = { data: null, update: 0, pending: null }
const steambots_limiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false })
app.post('/get-steambots', steambots_limiter, async (req, res) => {
  if(steambots_cache.data && Date.now() - steambots_cache.update < 60 * 1000){
    return res.json({status: "ok", update: steambots_cache.update, steambots: steambots_cache.data})
  }
  if(!bot_socket.socket){ return res.json({status: "error", update: Date.now()}) }

  if(!steambots_cache.pending){
    steambots_cache.pending = new Promise((resolve) => {
      const socket = bot_socket.socket
      const done = (steambots) => { clearTimeout(timer); resolve(steambots ?? null) }
      const timer = setTimeout(() => { socket.off('res_steambots', done); resolve(null) }, 8000)
      socket.once('res_steambots', done)
      socket.emit('get_steambots')
    }).then((steambots) => {
      if(steambots){ steambots_cache.data = steambots; steambots_cache.update = Date.now() }
      return steambots
    }).finally(() => { steambots_cache.pending = null })
  }

  const steambots = await steambots_cache.pending
  if(res.headersSent){ return }
  if(steambots){ res.json({status: "ok", update: steambots_cache.update, steambots}) }
  else { res.json({status: "error", update: Date.now()}) }
})

/* app.use('/', (req, res, next) => {
  res.render('developm.ejs', fn.res_data(false, req.user, undefined, (req.__ ? req.__('title.development') : 'Website in development - TF2Deal.com'), {view: 'developm'}))
}) */

const update_server = () => {
  // update trade_offers (get from bots)
} 

// Middleware to check if the user is logged in
const checkAuth = (req, res, next) => {
  if (mw.has_admin_session(req)) {
    next();
  } else {
    res.redirect('/login');
  }
};

// constant-time password check, so the response time doesn't hint at how much of the password was right
const same_secret = (given, expected) => {
  if (typeof given != 'string' || typeof expected != 'string' || expected.length == 0) { return false }
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}
const login_limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false })

update_server()
// run everyday at midnight

// Serve the login page
app.get('/login', mw.isLogged, mw.isAdmin, (req, res) => {
  res.render('./admin/login');
});

// Handle login form submission
app.post('/login', login_limiter, mw.isLogged, mw.isAdmin, (req, res) => {
  const { password } = req.body;

  if (same_secret(password, process.env.ADMIN_PASSWORD)) {
    req.session.admin_until = Date.now() + mw.ADMIN_SESSION_MS;
    res.clearCookie('authenticated'); // the old admin cookie isn't used any more
    res.redirect('/admin');
  } else {
    res.redirect('/login');
  }
});

app.get('/', mw.curPath, router.home);
app.get('/trade', mw.curPath, router.trade);
app.get('/items', mw.curPath, router.items);
app.get('/items/:item', mw.curPath, router.item_page);
app.get('/buy/:itemid', mw.curPath, router.home);

app.get('/giveaway', mw.curPath, router.giveaway);
app.get('/blog', mw.curPath, router.blog);
app.get('/blog/:slug', mw.curPath, router.blog_page);
app.get('/about', mw.curPath, router.about);
app.get('/terms-of-service', router.terms_of_service);
app.get('/cookies', router.cookies);
app.get('/support', mw.curPath, mw.isLogged, router.create_ticket);
// app.get('/premium', view_limiter, mw.curPath, router.premium); 
app.get('/updates', mw.curPath, router.updates);
app.get('/posts', mw.curPath, router.posts);

app.use('/profile', profileRoute)
app.use('/api', api);

import { router as adminRouter } from './routes/admin.js'
import { pure_model } from './model/Pure.js';
app.use('/admin', checkAuth, adminRouter);


app.get('/get_userDB_', mw.isLogged, async (req, res) => {
  if(req.cookies[`td_${req.user.steamid}`] == undefined ){
    update_cookie(req, res)
  } 
  else {
    if(req.cookies[`td_${req.user.steamid}`].hasOwnProperty('update')){
      if(Number(req.cookies[`td_${req.user.steamid}`].update) > Date.now()){
        res.redirect(req.cookies['td_current_url'] || '/trade')
      } else {
        update_cookie(req, res)
      }
    } else {
      update_cookie(req, res)
    }
  }

  async function update_cookie(req, res){
    await User.findOne({steamid: req.user.steamid}).then((user) => {
      /* req.user.data = user; */
      if(user == null){
        let saveUser = new User({
          steamid: req.user.steamid,
          firstlogin: Date.now()
        })
  
        saveUser.save().then(() => {
          const tradeOffer = (trade_offers.get(req.user.steamid) == undefined) ? {}:{id: trade_offers.get(req.user.steamid).id}
          const cookie = fn.user_cookie(req.user.steamid, saveUser, tradeOffer)
          res.cookie(cookie.name, cookie.value, cookie.setting).redirect("/?new_user=true")
        }).catch(() => {
          res.redirect('/logout?login_error=true')
        })
      } else {
        const tradeOffer = (trade_offers.get(req.user.steamid) == undefined) ? {}:{id: trade_offers.get(req.user.steamid).id}
        const cookie = fn.user_cookie(req.user.steamid, user, tradeOffer)
        let new_user = (user?.tradelink == "" || user?.tradelink == undefined) ? "?new_user=true":""
        res.cookie(cookie.name, cookie.value, cookie.setting).redirect((req.cookies['td_current_url'] || '/trade') + new_user)
      }
    }).catch(() => {
      res.redirect('/logout?login_error=true')
    })
  }
})

app.get(/^\/auth\/steam(\/return)?$/, passport.authenticate('steam', {
  failureRedirect: '/',
}), (req, res) => {
  res.redirect('/get_userDB_');
});

app.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    let login_error = (req.query['login_error'] == 'true') ? '?login_error=true':'' 
    res.redirect('/' + login_error);
  });
});

/* handling wrong paths */
app.use((req, res, next) => {
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.status(404).render('404', fn.res_data(true, req.user, user_cookie, (req.__ ? req.__('title.not_found') : '404 - Not found - TF2deal.com')))
  } else {
    res.status(404).render('404', fn.res_data(false, req.user, undefined, (req.__ ? req.__('title.not_found') : '404 - Not found - TF2deal.com')))
  }
})

let date = new Date().getDate();
let updating_items = false;
let sitemap_updated = new Date(Date.now()).toLocaleDateString();
let translations_checked = Date.now(); // AI translations: retry failed ones every hour (service/translate.js)

setInterval(async () => {
  if(key_price.updated <= Date.now() - 60*60*1000){
    await pure_model.findOne({name: "Mann Co. Supply Crate Key"}).then((pure) => {
          if(pure){
            key_price.metal = pure.value_raw;
            key_price.updated = Date.now();
          }        
        }).catch(() => {
          console.log('Failed to get pure value from DB')
        })
  }

  if(process.db_status.connected == true && sitemap_updated != new Date(Date.now()).toLocaleDateString()){
    sitemap_updated = new Date(Date.now()).toLocaleDateString();
    await item_model.bulkWrite([
        { updateMany: {
            filter: { "status": { $in: [1, 2] }, "type": { $not: /warpaint|skin/i }, $expr: { $lte: [ "$updated", Date.now() - 7*24*60*60*1000 ] }},
            update: { $set: { status: 0, buy: 0 } }
        } },
        { updateMany: {
            filter: { "status": { $in: [1, 2] }, "type": /warpaint|skin/i, $expr: { $lte: [ "$updated", Date.now() - 31*24*60*60*1000 ] }},
            update: { $set: { status: 0, buy: 0 } }
        } }
    ])

    await fn.update_sitemap()
  }

  // ends giveaways whose time is up and draws the winners
  if(process.db_status.connected == true){
    await giveaways.finish_due().catch((e) => console.log('Failed to finish giveaways', e.message))
  }

  if(process.db_status.connected == true && translations_checked <= Date.now() - 60*60*1000){
    translations_checked = Date.now();
    translate.sweep({ quiet: true }).catch((e) => console.log('translate: retry failed', e.message));
  }

  if(item_socket.socket){
    item_socket.socket.emit('get_status')
  }

  if(bot_socket.socket){
    bot_socket.socket.emit('get_active_trades')
  }

  const currentMonth = new Date().getMonth();

  // Determine the season
  if (currentMonth >= 5 && currentMonth <= 7) {
    season = 'summer'; // June (5) to August (7)
  } else if (currentMonth >= 9 && currentMonth <= 10) {
      season = 'halloween'; // October (9) to November (10)
  } else {
      season = 'winter'; // December (11) to May (4)
  }
}, 60 * 1000);

setTimeout(() => {
  const currentMonth = new Date().getMonth();

  // Determine the season
  if (currentMonth >= 5 && currentMonth <= 7) {
    season = 'summer'; // June (5) to August (7)
  } else if (currentMonth >= 9 && currentMonth <= 10) {
      season = 'halloween'; // October (9) to November (10)
  } else {
      season = 'winter'; // December (11) to May (4)
  }
}, 5000);

app.use((err, req, res, next) => {
  console.log(err)
  if (res.headersSent) return next(err)
  if (req.xhr) return res.status(500).send({ status: "error", error: 'Something failed!' })
  res.status(500)
  if(req.user){
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    res.render('error.ejs', fn.res_data(true, req.user, user_cookie, (req.__ ? req.__('title.error') : 'Error - TF2Deal.com'), {view: 'error'}))
  } else {
    res.render('error.ejs', fn.res_data(false, undefined, undefined, (req.__ ? req.__('title.error') : 'Error - TF2Deal.com'), {view: 'error'}))
  }
})

export {
  bots_state,
  activeTrades,
  trade_offers as offers,
  Bot_Server as bot_server,
  Giveaway as giveaway,
  users,
  mongoose,
  site_inventory,
  season,
  bptf_api
}

connectDB().then(() => {
  createSocket(io)
  server.listen(process.env.PORT || PORT, () => console.log(`running on URL localhost:${PORT}`)); 
})