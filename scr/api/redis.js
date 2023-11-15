const express = require('express');
const router = express.Router();

const redis = require("redis");
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname + '/config/', './.env') });

const User = require('../model/User'); // store in httpOnly cookie, update on change as well as DB
const Unusual_Effect = require('../model/dev/_itemParticle')

global.redis_connected = false;
const client = redis.createClient({
  legacyMode: true,
  PORT: 6379
})
client.connect().catch(console.error)

client.on('ready', () => {
  redis_connected = true;
  console.log('connected to Redis')
  client.on('error', function (err) {
    redis_connected = false;
    client.disconnect()
    console.log('Redis connection lost')
  })
});

// Cache middleware
function inv_user(req, res, next) {
    if(redis_connected == false){
      next()
    }
  
    const user_steamid = req.user.steamid;
  
    client.get(user_steamid, (err, data) => {
      if (err) {
        throw  err;
      }
      
      if (data !== null) {
        res.send(JSON.parse(data));
      } else {
        next();
      }
    });
  }

module.exports = {
    client,
    inv_user
};