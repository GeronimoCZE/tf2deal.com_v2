import * as fn from './fn.js'
  
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
// Kept in the server-side session (not a cookie the browser could set itself) and valid for 1 hour.
const ADMIN_SESSION_MS = 60 * 60 * 1000
const has_admin_session = (req) => Boolean(
  req.user?.steamid && process.env.ADMIN_STEAMID &&
  req.user.steamid === process.env.ADMIN_STEAMID &&
  Number(req.session?.admin_until) > Date.now()
)

const curPath = (req, res, next) => {
  res.cookie('td_current_url', req.originalUrl, {httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', secure: true}) // page to return to after login
  if(req.user){
    if(req.cookies[`td_${req.user.steamid}`] == undefined){
      return res.redirect('/logout')
    } else {
      if(req.cookies[`td_${req.user.steamid}`].user?.tradelink == 'null' || req.cookies[`td_${req.user.steamid}`].user?.tradelink == '' || typeof req.cookies[`td_${req.user.steamid}`].user?.tradelink == "undefined"){
        return res.render('new_user', fn.res_data(true, req.user, req.cookies[`td_${req.user.steamid}`], req.__('title.register')))
      } else {
        return next();
      }
    }
  } else {
    return next();
  }
}

export {
    curPath, isLogged, isAdmin, has_admin_session, ADMIN_SESSION_MS
}
