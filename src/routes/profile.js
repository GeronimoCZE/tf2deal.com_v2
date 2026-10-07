import express from 'express'

import * as fn from '../fn.js'
import * as mw from '../mw.js'

import User from '../model/User.js'
import { trade_model } from '../model/Trade.js'
import { ticket_model } from '../model/Ticket.js'

export const router = express.Router()

// Express 4 doesn't catch errors thrown in async handlers (one bad request could stop the whole server),
// so every handler's promise is passed on to the error handler at the bottom.
for (const method of ['get', 'post']) {
  const register = router[method].bind(router);
  router[method] = (path, ...handlers) => register(path, ...handlers.map((handler) => (req, res, next) => {
    try { return Promise.resolve(handler(req, res, next)).catch(next) } catch (error) { next(error) }
  }));
}


router.use('/', mw.isLogged)

router.get('/', async (req, res, next) => {
  const user_cookie = req.cookies[`td_${req.user.steamid}`]

  try {
    const steamid = req.user.steamid
    const [user_doc, trades, open_tickets] = await Promise.all([
      User.findOne({ steamid }, { wishlist: 1, giveaways: 1, email: 1 }).lean(),
      trade_model.countDocuments({ partnerSteamID: steamid }),
      ticket_model.countDocuments({ steamid, status: { $ne: 'closed' } })
    ])

    res.render(
      './profile/profile',
      fn.res_data(
        true,
        req.user,
        user_cookie ?? undefined,
        req.__('title.profile'),
        {
          view: 'profile',
          stats: {
            trades,
            wishlist: user_doc?.wishlist?.length || 0,
            giveaway_entries: user_doc?.giveaways?.entries || 0,
            giveaway_wins: user_doc?.giveaways?.won || 0,
            open_tickets
          },
          email: user_doc?.email || ''
        },
        { new_user: req.query.new_user }
      )
    )
  } catch (err) {
    next(err)
  }
})

router.get('/trades', (req, res) => {
  const user_cookie = req.cookies[`td_${req.user.steamid}`]

  res.render(
    './profile/trades',
    fn.res_data(
      true,
      req.user,
      user_cookie ?? undefined,
      req.__('title.profile_trades')
    )
  )
})

router.get('/wishlist', (req, res) => {
  const user_cookie = req.cookies[`td_${req.user.steamid}`]

  res.render(
    './profile/wishlist',
    fn.res_data(
      true,
      req.user,
      user_cookie ?? undefined,
      req.__('title.profile_wishlist')
    )
  )
})

router.get('/tickets', (req, res) => {
  const user_cookie = req.cookies[`td_${req.user.steamid}`]

  res.render(
    './profile/tickets',
    fn.res_data(
      true,
      req.user,
      user_cookie ?? undefined,
      req.__('title.profile_tickets')
    )
  )
})

router.get('/giveaways', (req, res) => {
  const user_cookie = req.cookies[`td_${req.user.steamid}`]

  res.render(
    './profile/giveaways',
    fn.res_data(
      true,
      req.user,
      user_cookie ?? undefined,
      req.__('title.profile_giveaways')
    )
  )
})

router.use((err, req, res, next) => {
  console.error('api error', req.method, req.originalUrl, err?.message)
  if (res.headersSent) { return }
  res.status(500).json({ status: "error", message: "Server error" })
})
