const User = require('../model/User')
const Instance = require('../model/items/Instance')
const GlobalStock = require('../model/items/_itemTypes')
const Unusual_Effect = require('../model/dev/_itemParticle')
const Skins = require('../model/dev/_itemSkins')
const Warpaints = require('../model/dev/_itemWarpaints');


const get_items_types = async() => {
    return new Promise(async(resolve, reject) => {
    if(require('../app').mongoose.connection.readyState == 1){

        const uniqueCombinations = await Instance.aggregate([
          // Stage 1: Filter by status
          {
            $match: { status: 1 }
          },
          // Stage 2: Ensure elevatedQuality is never null
          {
            $addFields: {
              elevated_qualityID: { $ifNull: ["$elevated_qualityID", false] } // Default to false if null or missing
            }
          },
          // Stage 3: Compute price class using buy.price
          {
            $addFields: {
              priceClass: {
                $switch: {
                  branches: [
                    { case: { $lt: ["$buy.key", 2] }, then: "Under 2" },
                    { case: { $and: [{ $gte: ["$buy.key", 2] }, { $lt: ["$buy.key", 10] }] }, then: "2 to 10" },
                    { case: { $and: [{ $gte: ["$buy.key", 10] }, { $lt: ["$buy.key", 35] }] }, then: "10 to 35" },
                    { case: { $and: [{ $gte: ["$buy.key", 35] }, { $lt: ["$buy.key", 85] }] }, then: "35 to 85" },
                    { case: { $gte: ["$buy.key", 85] }, then: "Over 85" }
                  ],
                  default: "Unknown"
                }
              }
            }
          },
          // Stage 4: Group by type, qualityID, elevatedQuality, and priceClass
          {
            $group: {
              _id: {
                type: "$type",
                qualityID: "$qualityID",
                elevated_qualityID: "$elevated_qualityID",
                priceClass: "$priceClass"
              },
              count: { $sum: 1 }, // Count documents in each group
              totalStockCur: { $sum: "$stock.cur" }, // Sum stock.cur
              totalStockLimit: { $sum: "$stock.limit" } // Sum stock.limit
            }
          },
          // Stage 5: Format the output
          {
            $project: {
              _id: 0,
              type: "$_id.type",
              qualityID: "$_id.qualityID",
              elevated_qualityID: "$_id.elevated_qualityID",
              priceClass: "$_id.priceClass",
              count: 1,
              totalStockCur: 1,
              totalStockLimit: 1
            }
          }
        ]);
    
        const bulkOps = uniqueCombinations.map((item) => ({
          updateOne: {
            filter: { qualityID: item.qualityID,  elevated_qualityID: item.elevated_qualityID, type: item.type, priceClass: item.priceClass }, // Match the document by `id`
            update: { $set: { qualityID: item.qualityID, elevated_qualityID: item.elevated_qualityID, type: item.type, priceClass: item.priceClass, count: item.count, "stock.cur": item.totalStockCur, "stock.total_limit": item.totalStockLimit, updated: Date.now() } },  // Set the fields to update
            upsert: true,            // Insert the document if it doesn't exist
          },
        }));
        const update_ops = uniqueCombinations.map((item) => ({
          updateOne: {
            filter: { "stock.global_limit": { $exists: false } }, // Match the document by `id`
            update: { $set: { "stock.global_limit": 10, weight: 1 } }
          },
        }));
    
        await GlobalStock.bulkWrite(bulkOps);
        await GlobalStock.bulkWrite(update_ops);
        const global_stock = await GlobalStock.find()
    
        resolve(global_stock)
      } else {
        reject()
      }
    })
}

const get_active_bots = () => {
    const app = require('../app');
    return new Promise((resolve, reject) => {
        if(app.bot_server.status == 'online'){
            resolve([1,2])
        } else {
            resolve([1,2])
            /* reject('socket_missing') */
        }
    })
}

const calculateItemSpace = (totalSpace, itemTypes) => {
    // Calculate the total weight of all item types
    const totalWeight = itemTypes.reduce((sum, item) => sum + item.weight, 0);

    // Allocate at least 1 space to every item with a non-zero weight
    const allocation = {};
    let guaranteedSpace = 0;

    itemTypes.forEach((item) => {
        allocation[item.type] = item.weight > 0 ? 1 : 0; // Minimum 1 if weight > 0
        guaranteedSpace += allocation[item.type];
    });

    // Remaining space to allocate proportionally
    let remainingSpace = totalSpace - guaranteedSpace;

    // Handle proportional distribution of the remaining space
    if (remainingSpace > 0) {
        const rawAllocations = {}; // Store raw (decimal) values for precise handling
        let totalAllocatedSpace = guaranteedSpace;

        itemTypes.forEach((item) => {
        if (item.weight > 0) {
            const rawSpace = (item.weight / totalWeight) * remainingSpace;
            const additionalSpace = Math.floor(rawSpace);
            allocation[item.type] += additionalSpace; // Add proportional space
            rawAllocations[item.type] = rawSpace; // Store raw value for fractional handling
            totalAllocatedSpace += additionalSpace;
        }
        });

        // Distribute any remaining space (from rounding) proportionally by fractional parts
        remainingSpace = totalSpace - totalAllocatedSpace;

        if (remainingSpace > 0) {
        const fractionalParts = itemTypes
            .filter((item) => item.weight > 0)
            .map((item) => ({
            type: item.type,
            fractional: rawAllocations[item.type] - Math.floor(rawAllocations[item.type])
            }));

        // Sort by largest fractional part for fair distribution
        fractionalParts.sort((a, b) => b.fractional - a.fractional);

        for (const item of fractionalParts) {
            if (remainingSpace === 0) break;
            allocation[item.type]++;
            remainingSpace--;
        }
        }
    }

    return allocation;
}

module.exports = {
    get_items_types, get_active_bots, calculateItemSpace
}