const fn = require('./fn')

const isRgstrd = (req, res, next) => {
    // apply to all main endpoints
  }
  
const isLogged = (req, res, next) => {
    if(req.user){
      return next();
    }
    else{
      res.render('loginReq', fn.res_data(false, req.user, undefined, ''))
    }
};
  
const isAdmin = (req, res, next) => {
    if(req.user){
        const user_cookie = req.cookies[`td_${req.user.steamid}`];
        if (req.user.steamid === process.env.ADMIN_STEAMID) {
            return next();
        }
        return res.render('404', fn.res_data(true, req.user, user_cookie, ''))
    }
    res.render('404', fn.res_data(false, req.user, undefined, ''))
};

const curPath = (req, res, next) => {
  res.cookie('td_current_url', req.url, {httpOnly: true, maxAge: Date.now(2147483647 * 1000), sameSite: 'lax', secure: true})
  if(req.user){
    if(req.cookies[`td_${req.user.steamid}`] == undefined){
      res.redirect('/logout')
    } else {
      return next();
    }
  } else {
    return next();
  }
  
  if(req.cookies['td_current_url'] == undefined){
    res.render('cookie_enabler', fn.res_data(false, req.user, undefined, ''))
  }
}

module.exports = {
    curPath, isRgstrd, isLogged, isAdmin
}
