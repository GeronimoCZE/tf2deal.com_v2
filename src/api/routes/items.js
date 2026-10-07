import express from 'express';
export const router = express.Router();

import rateLimit from 'express-rate-limit';
import apicache from 'apicache';
import mongoose from 'mongoose';
import {item_model as Instance} from '../../model/Item.js'; // add .js if using ES modules with Node
import { type } from 'os';
import { log } from 'console';
import { safe_equal } from '../../service/settings.js';

const cache = apicache.middleware;

const items_rate_limit = rateLimit({
  windowMs: 3 * 1000,
  max: 1,
  message: "You have made too many requests."
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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function germanRegex(text) {
  const map = {
    a: "[aä]",
    o: "[oö]",
    u: "[uü]",
    s: "[sß]"
  };

  return escapeRegex(text)
    .split("")
    .map(ch => map[ch.toLowerCase()] || ch)
    .join("");
}

router.post('/', items_rate_limit, async (req, res) => {
  if (process.db_status.connected === true) {
    try {
      const limit = 15;

      console.log(req.body);
      

      const skip = (req.body?.page === undefined || typeof req.body?.page !== 'number')
        ? 0 * limit
        : Math.round(parseFloat(req.body.page) * limit);
      const name = (req.body?.name === undefined || typeof req.body?.name !== 'string')
        ? undefined
        : req.body.name;
      const qualityID = (req.body?.quality === undefined || typeof req.body?.quality !== 'string' || item_config.Quality[req.body.quality] === undefined)
        ? undefined
        : item_config.Quality[req.body.quality].id;
      const type = (req.body?.type === undefined || typeof req.body?.type !== 'string')
        ? undefined
        : req.body.type;
      const particle = (typeof req.body?.particle === 'string')
        ? req.body.particle
        : undefined;
      const warpaint = (req.body?.warpaint === undefined || typeof req.body?.warpaint !== 'string')
        ? undefined
        : req.body.warpaint;
      const clas = (req.body?.class === undefined || typeof req.body?.class !== 'string')
        ? undefined
        : req.body.class;
      const stock = (req.body?.stock === undefined || typeof req.body?.stock !== 'string')
        ? undefined
        : req.body.stock;

      const sort = (req.body?.sort === undefined || typeof req.body?.sort !== 'string')
        ? undefined
        : req.body.sort;

      let sort_obj = { "stock.items_length": -1, bp_sku: -1 };
      if (sort !== undefined) {
        if (sort === 'Price (asc)') { sort_obj = { 'sell': 1, ...sort_obj }; }
        else if (sort === 'Price (desc)') { sort_obj = { 'sell': -1, ...sort_obj }; }
        else if (sort === 'Popular (desc)') { sort_obj = { 'bptf_data.buyorders': -1, ...sort_obj }; }
      }

      const nameWords =
        typeof name === "string"
          ? name.toLowerCase().trim().split(/\s+/).filter(Boolean)
          : [];

      const matchStage = {
        $or: [
          { status: 1 },
          { "stock.items": { $exists: true, $not: { $size: 0 } } }
        ],
        ...(nameWords.length > 0 && {
            $and: nameWords.map(word => ({
              bp_sku: { $regex: germanRegex(word), $options: "i" }
            }))
        }),
        ...(qualityID !== undefined && { qualityID: String(qualityID) }),
        ...(type !== undefined && { type: { "$regex": (type == "War Paint") ? "warpaint" : escapeRegex(String(type)).slice(0, 100), "$options": "i" } }),
        ...(typeof particle === "string" && { effectID: Number(particle) }),
        ...(warpaint !== undefined && { name: { "$regex": escapeRegex(String(warpaint)).slice(0, 100), "$options": "i" } }),
        ...(clas !== undefined && {
          classes: {
            "$all": clas.includes(',')
              ? clas.split(',').map(str => str.trim())
              : [clas]
          }
        }),
        ...(stock !== undefined && stock === 'Can sell' && { $expr: { $lt: [{ $size: "$stock.items" }, "$stock.limit"] } }),
        ...(stock !== undefined && stock === 'Can buy' && { $expr: { $gt: [{ $size: "$stock.items" }, 0] } }),
        "$nor": [
          { "sell": 0 },
          { "sell": null },
          { "sell": NaN },
          { "buy": null },
          { "buy": NaN },
          { "buy": 0 }
        ]
      };

      const project = {
        bp_sku: 1, type: 1, stock: 1, buy: 1, sell: 1, qualityID: 1, effectID: 1, image: 1, bptf_data: 1,
        _id: 0
      };

      const mongoose_pipeline = [
        { $match: matchStage },
        { $project: project },
        { $addFields: { "stock.items_length": { $size: "$stock.items" } } },
        { $sort: sort_obj },
        { $skip: skip },
        { $limit: limit }
      ];

      const count_pipeline = [
        { $match: matchStage },
        { $count: "totalDocuments" }
      ];

      console.log(mongoose_pipeline[0]["$match"]["$or"]);
      

      try {
        const [results, countResult] = await Promise.all([
          Instance.aggregate(mongoose_pipeline).exec(),
          Instance.aggregate(count_pipeline).exec()
        ]);
        const totalDocuments = countResult.length > 0 ? countResult[0].totalDocuments : 0;
        res.status(200).json({ status: "ok", item_count: totalDocuments, response: results });
      } catch (err) {
        res.status(500).json({ status: "error", message: "db error" });
      }
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