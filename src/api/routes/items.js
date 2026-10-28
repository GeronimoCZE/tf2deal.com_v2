import express from 'express';
export const router = express.Router();

import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import {item_model as Instance} from '../../model/Item.js'; // add .js if using ES modules with Node
import { type } from 'os';
import { log } from 'console';
import { safe_equal } from '../../service/settings.js';
import * as item_lists from '../../service/item_lists.js';

// the /items list asks again on every filter change, so a few quick clicks have to fit
const items_rate_limit = rateLimit({
  windowMs: 10 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req) => ({ status: "error", message: req.__ ? req.__('api.too_many_requests') : "Too many requests! Try again later..." })
});

const item_config = {
    "Quality": 
    {
        "Normal": {"color": "B2B2B2", "id": 0},
        "Genuine": {"color": "4D7455", "id": 1},
        "Vintage": {"color": "476291", "id": 3},
        "Unusual": {"color": "8650AC", "id": 5},
        "Unique": {"color": "FFD700", "id": 6},
        "Community": {"color": "70B04A", "id": 7},
        "Valve": {"color": "A50F79", "id": 8},
        "Self-Made": {"color": "70B04A", "id": 9},
        "Strange": {"color": "CF6A32", "id": 11},
        "Haunted": {"color": "38F3AB", "id": 13},
        "Collector's": {"color": "AA0000", "id": 14},
        "Decorated": {"color": "FAFAFA", "id": 15},
        "0": {"color": "B2B2B2", "name": "Normal"},
        "1": {"color": "4D7455", "name": "Genuine"},
        "3": {"color": "476291", "name": "Vintage"},
        "5": {"color": "8650AC", "name": "Unusual"},
        "6": {"color": "FFD700", "name": "Unique"},
        "7": {"color": "70B04A", "name": "Community"},
        "8": {"color": "A50F79", "name": "Valve"},
        "9": {"color": "70B04A", "name": "Self-Made"},
        "11": {"color": "CF6A32", "name": "Strange"},
        "13": {"color": "38F3AB", "name": "Haunted"},
        "14": {"color": "AA0000", "name": "Collector's"},
        "15": {"color": "FAFAFA", "name": "Decorated Weapon"}
    },

    "Types": {

    },

    "Grades": {
        "Civilian": "#B0C3D9",
        "Freelance": "#5E98D9",
        "Mercenary": "#4B69FF",
        "Commando": "#8847FF",
        "Assassin": "#D32CE6",
        "Elite": "#EB4B4B"
    }
}

router.use('/', (req, res, next) => {
  // safe_equal is false when the .env value is missing, so an unset CLIENT_TOKEN no longer lets everyone in
  if (safe_equal(req.body?.client_token, process.env.CLIENT_TOKEN) && safe_equal(req.body?.client_secret, process.env.CLIENT_SECRET)) {
    next();
  } else {
    res.status(500).json({ status: "error", message: 'you have no access to this api' });
  }
});

router.post('/', items_rate_limit, async (req, res) => {
  if (process.db_status.connected === true) {
    try {
      const limit = 15;

      const skip = (req.body?.page === undefined || typeof req.body?.page !== 'number')
        ? 0 * limit
        : Math.round(parseFloat(req.body.page) * limit);
      const text = (key) => (typeof req.body?.[key] === 'string') ? req.body[key] : undefined
      const quality = text('quality')
      const clas = text('class')

      // service/item_lists.js keeps every card in memory (read again once a minute) and filters and sorts them there
      const filters = {
        ...(text('name') !== undefined && { name: text('name') }),
        ...(quality !== undefined && item_config.Quality[quality]?.id !== undefined && { qualityID: String(item_config.Quality[quality].id) }),
        ...(text('type') !== undefined && { type: text('type') }),
        ...(text('particle') !== undefined && { particle: text('particle') }),
        ...(text('warpaint') !== undefined && { warpaint: text('warpaint') }),
        ...(clas !== undefined && { classes: clas.split(',').map((str) => str.trim()) }),
        ...(text('stock') !== undefined && { stock: text('stock') })
      };

      const list = await item_lists.cards(filters, text('sort'))
      res.status(200).json({ status: "ok", item_count: list.length, response: list.slice(skip, skip + limit).map(item_lists.public_card) });
    } catch {
      res.status(500).json({ status: "error", message: "db error" });
    }
  } else {
    res.status(500).json({ status: "error", message: "db error" });
  }
});

router.post('/:bp_sku', (req, res) => {
  try {
    const {intent, steamid} = req.body
    const bp_sku = req.params.bp_sku
  
    console.log(intent, bp_sku);
  
    if(intent == "sell" && typeof steamid != "no_session"){
      
    }
    else if(intent == "buy"){
      
    }
    res.status(501).json({ "success": 0, items: [] }) // not implemented yet
  } catch (error) {
    res.status(500).json({ "success": 0, items: [] }) 
  }
})