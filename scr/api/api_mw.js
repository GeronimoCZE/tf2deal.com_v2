const isLogged = (req, res, next) => {
    if(req.user){
      return next();
    } else {
      res.status(511).json('Missing credentials. You have to be signed in.')
    }
};

const isServer = (req, res, next) => {
    if(req.query.server_token == process.env.API_KEY_TF2DEAL){
        return next();
    } else {
        res.status(511).json('You are not allowed to GET/POST data in here!')
    }
};

const isAdmin = (req, res, next) => {
    if(req.user){
        if (req.user.steamid === env.ADMIN_STEAMID) {
            return next();
        }
        return res.status(511).json('You are not allowed to GET/POST data in here!')
    }
    res.status(511).json('You are not allowed to GET/POST data in here!')
};


module.exports = {
    isLogged, isServer, isAdmin
}