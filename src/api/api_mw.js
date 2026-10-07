import { safe_equal } from '../service/settings.js'

const isLogged = (req, res, next) => {
    if(req.user){
      return next();
    } else {
      res.status(511).json('Missing credentials. You have to be signed in.')
    }
};

const isServer = (req, res, next) => {
    if(safe_equal(req.query.server_token, process.env.API_KEY_TF2DEAL)){ // false when the key isn't set
        return next();
    } else {
        res.status(511).json('You are not allowed to GET/POST data in here!')
    }
};

const isAdmin = (req, res, next) => {
    if(req.user){
        if (req.user.steamid === process.env.ADMIN_STEAMID) {
            return next();
        }
        return res.status(511).json('You are not allowed to GET/POST data in here!')
    }
    res.status(511).json('You are not allowed to GET/POST data in here!')
};


export {
    isLogged, isServer, isAdmin
}