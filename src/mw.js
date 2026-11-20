import * as fn from './fn.js'
import * as admin_sessions from './service/admin_sessions.js'
  
const isLogged = (req, res, next) => {
    if(req.user){
      return next();
    }
    else{
      res.redirect('/auth/steam')
    }
};
  
const isAdmin = async (req, res, next) => {
    if(req.user){
        const user_cookie = req.cookies[`td_${req.user.steamid}`];
        if (req.user.steamid === process.env.ADMIN_STEAMID) {
            return next();
        }
        return res.render('404', fn.res_data(true, req.user, user_cookie, ''))
    }
    res.render('404', fn.res_data(false, req.user, undefined, ''))
};

// Admin panel access: the admin's Steam account AND the admin password entered on /login in this session.
// Kept in the server-side session (not a cookie the browser could set itself) and valid for 1 hour, in the browser
// (user agent + network) that entered it, until the admin logs out or locks the panel (service/admin_sessions.js).
const ADMIN_SESSION_MS = 60 * 60 * 1000
const has_admin_session = (req) => Boolean(
  req.user?.steamid && process.env.ADMIN_STEAMID &&
  req.user.steamid === process.env.ADMIN_STEAMID &&
  Number(req.session?.admin_until) > Date.now() &&
  admin_sessions.valid(req)
)

// A request the site's own pages made (forms, fetch), not one another site sent with the admin's cookies. Browsers say
// where a request comes from in Sec-Fetch-Site; older ones only in Origin (on POSTs).
const same_origin = (req) => {
  const site = req.get('sec-fetch-site')
  if (site) return site === 'same-origin' || site === 'none'
  const origin = req.get('origin')
  if (!origin) return true
  try {
    const from = new URL(origin)
    if (from.host === req.get('host')) return true
    return Boolean(process.env.SITE_URL) && from.origin === new URL(process.env.SITE_URL).origin
  } catch (e) {
    return false
  }
}

const curPath = (req, res, next) => {
  res.cookie('td_current_url', req.originalUrl, {httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', secure: true}) // page to return to after login
  if(req.user){
    if(req.cookies[`td_${req.user.steamid}`] == undefined){
      return res.redirect('/logout')
    }
    // no trade URL yet: the page opens as usual with the trade URL window over it (app.js needs_trade_url)
    return next();
  } else {
    return next();
  }
}

export {
    curPath, isLogged, isAdmin, has_admin_session, same_origin, ADMIN_SESSION_MS
}
