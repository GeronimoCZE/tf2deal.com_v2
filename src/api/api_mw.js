import { safe_equal } from '../service/settings.js'
import { has_admin_session } from '../mw.js'

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

// the admin's Steam account with the panel unlocked (admin password, mw.js has_admin_session)
const isAdmin = (req, res, next) => {
    if(has_admin_session(req)){
        return next();
    }
    res.status(511).json('You are not allowed to GET/POST data in here!')
};


export {
    isLogged, isServer, isAdmin
}