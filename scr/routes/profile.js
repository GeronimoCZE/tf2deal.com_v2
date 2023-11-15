const { cookie } = require('request');
const fn = require('../fn');
const mw = require('../mw')

const express = require('express');
const router = express.Router();

router.use('/', mw.isLogged)

router.get('/', (req, res) => {
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    if(user_cookie != undefined){
        res.render('./profile/profile', fn.res_data(true, req.user, user_cookie, 'profile', '', {new_user: req.query.new_user}))
    } else {
        res.render('./profile/profile', fn.res_data(true, req.user, undefined, 'profile', '', {new_user: req.query.new_user}))
    }
})

router.get('/history', (req, res) => {
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    if(user_cookie != undefined){
        res.render('./profile/history', fn.res_data(true, req.user, user_cookie, 'history'))
    } else {
        res.render('./profile/history', fn.res_data(true, req.user, undefined, 'history'))
    }
})

router.get('/settings', (req, res) => {
    const user_cookie = req.cookies[`td_${req.user.steamid}`];
    if(user_cookie != undefined){
        res.render('./profile/settings', fn.res_data(true, req.user, user_cookie, 'settings'))
    } else {
        res.render('./profile/settings', fn.res_data(true, req.user, undefined, 'settings'))
    }
})

module.exports = router;