const fn = require('../fn');
const mw = require('../mw')

const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer')
const fetch = require('node-fetch')
const fs = require('fs')

const item_attributes = require('../config/Items.json')
const User = require('../model/User')
const Instance = require('../model/items/Instance')
const Unusual_Effect = require('../model/dev/_itemParticle')
const Skins = require('../model/dev/_itemSkins')
const Warpaints = require('../model/dev/_itemWarpaints');
const { json } = require('body-parser');
const { config } = require('process');
const config_setting = require('../config/config.json')

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

router.use('/', mw.isAdmin)

let market_items = []
let bp_schema = []
let item_schema = []
let item_skins = []
let item_warpaints = [];

let item_suggestions = []
const failed_items = new Map()

// {"response":{"success":0,"message":"This web API requires a Premium subscription. Please visit https:\/\/backpack.tf\/premium\/subscribe."}}
// {"status":402,"error":"You have no balance on your account. Please add more funds to get access to the API."}

router.get('/', (req, res) => {
  res.redirect('/admin/stats')
})

router.get('/stats', (req, res) => {
    // shows status of third party api (subscription expiration)
    // general overview of site activities and stats 
    // show trades
    // show users (and their activity snap)
    // tool to manage all bots (add, edit, delete)
    res.render('./admin/stats', fn.res_data(true, req.user, undefined, 'stats'))
})

router.get('/items', (req, res) => {
  res.render('./admin/items', fn.res_data(true, req.user, undefined, 'items'))
})
router.get('/dev', (req, res) => {
  res.render('./admin/dev', fn.res_data(true, req.user, undefined, 'dev'))
})

router.post('/skins', async (req, res) => {
  await scrape_skins().then(
    function(skins_length){
      res.send({status: "1", updated_items: skins_length, type: "skins"})
    }, 
    function(skins_length){
      res.send({status: "0", updated_items: skins_length, type: "skins"})
    }
  )
})

router.post('/warpaints', async (req, res) => {
  await scrape_warpaints().then(
    function(warpaints_length){
      res.send({status: "1", updated_items: warpaints_length, type: "warpaints"})
    }, 
    function(warpaints_length){
      res.send({status: "0", updated_items: warpaints_length, type: "warpaints"})
    }
  )
})

router.post('/particles', async (req, res) => {
  await scrape_particles().then(
    function(particles_length){
      res.send({status: "1", updated_items: particles_length, type: "particles"})
    }, 
    function(particles_length){
      res.send({status: "0", updated_items: particles_length, type: "particles"})
    }
  )
})

router.get('/suggestions', async (req, res) => {
  res.send( item_suggestions )
})

router.post('/suggestions', async (req, res) => {
  await fetch_tf2_items().then(
    function(suggestions_length){
      res.send({status: "1", updated_items: suggestions_length, type: "suggestions"})
    }, 
    function(suggestions_length){
      res.send({status: "0", updated_items: suggestions_length, type: "suggestions"})
    }
  )
})

async function fetch_tf2_items() {
  await delay(18000)
  return new Promise(async (resolve, reject) => {
    console.log(`[${new Date().getHours()+':'+new Date().getMinutes()}] item suggestions - fetching sources...`)
    try{
      item_warpaints = await Warpaints.find()
      item_skins = await Skins.find()
    } catch{}

    fetch(`https://api.steamapis.com/market/items/440?api_key=O64Uh6TNp2owvWGS4JSSS8gspnc`)
      .then((res) => {  
          return res.json() 
      })
      .then(async (jsonResponse) => {
          market_items = jsonResponse.data;

          fetch(`${process.env.BPAPI_ENDPOINT}prices`)
            .then((res) => {  
                return res.json() 
            })
            .then(async (jsonResponse) => {
                if(jsonResponse.response.success == 1 && jsonResponse.response.items.length != 0){
                    bp_schema = jsonResponse.response.items
                } 

                fetch_item_schema(0)

                function fetch_item_schema(start){
                  fetch(`http://cors.tf2deal.com:8080/https://api.steampowered.com/IEconItems_440/GetSchemaItems/v1/?key=822B9C17E98DD8C57532F14A33507B4B&start=${start}`)
                    .then((res) => {  
                        return res.json() 
                    })
                    .then(async (jsonResponse) => {
                        item_schema.push(jsonResponse.result.items) 
                        if(jsonResponse.result?.next != undefined){
                            fetch_item_schema(jsonResponse.result.next)
                        } else {
                            item_schema = item_schema.flat(Infinity)
                            console.log(`[${new Date().getHours()+':'+new Date().getMinutes()}] item suggestions - creation in progress...`)

                            // create suggestions
                            create_suggestions()
                        }
                    })
                }
                    // bpschema + itemschema = bptf suggestions
                    // marketitems = skin & warpaint suggestions
                    // weapons only if exists on bp + has item_class starting: tf_weapon_******
                    // taunts first take from bp, then newer from scheme + has item_slot: taunt
                    // cosmetics from bptf, then newer from scheme + has item_slot: misc

                function create_suggestions() {
                    let suggestions = [];
                    let default_weapons = [];
                    let weapon_wears = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle Scarred']

                    if(bp_schema.length == 0){
                      reject()
                    }
                    
                    let bp_items = {
                      names: [],
                      defindexes: [],
                      prices: [], // currency: hat => random craft hat
                      series: []
                    }

                    for (const [key, value] of Object.entries(bp_schema)) {
                      const price = { qualities: [], craftability: [], price: [], series: [] }
                      for (const [ke, valu] of Object.entries(value.prices)){
                        if(valu.hasOwnProperty("Tradable") == false){
                          continue;
                        }

                        let craft = []
                        let pric = [] 
                        for (const [k, val] of Object.entries(valu["Tradable"])){
                          craft.push(k)
                          pric.push({val: val[0]?.value, curr: val[0]?.currency})
                          if(ke == "6"){
                            try{
                              for (const [s, va] of Object.entries(val)){
                                price.series.push(s)
                              }
                            } catch{ }
                          }
                        }
                        price.qualities.push(ke)
                        price.craftability.push(craft)
                        price.price.push(pric)
                      }

                      if(price.qualities.length == 0){
                        continue;
                      }
                      
                      bp_items.names.push(key)
                      bp_items.defindexes.push(value.defindex)
                      bp_items.prices.push(price)
                    }

                    let bp_item_descs = item_schema.filter((item) => bp_items.defindexes.some(defindex => {
                        return defindex.includes(item.defindex);
                    }))

                    // Unusualifier & Strangifier take instances from scm (=> remove template suggestion)

                    for (let i = 0; i < bp_items.defindexes.length; i++) {
                      for (let y = 0; y < bp_items.defindexes[i].length; y++) {
                        if(
                          ['Mann Co. Supply Crate Key', 'Refined Metal', 'Reclaimed Metal', 'Scrap Metal',
                           'Chemistry Set', 'Upgrade to Premium Gift', 'Team Fortress 2 - Upgrade to Premium'].includes(bp_items.names[i])
                          ||
                          bp_items.names[i].includes('Costume Transmogrifier') || bp_items.names[i].includes('Token - ')
                        ){ break; }
                        if([9,10,11,12].includes(bp_items.defindexes[i][y])){ continue; }

                        const index = bp_item_descs.findIndex(obj => { return obj.defindex == bp_items.defindexes[i][y] })
                        if(index != -1){
                          
                          let type = '';
                          let attributes = '';
                          let rgb_tint = [];
                          let method = 'bp'

                          if(bp_item_descs[index].image_url == 'http://media.steampowered.com/apps/440/icons/key.be0a5e2cda3a039132c35b67319829d785e50352.png'){
                            break;
                          }
                          if(bp_item_descs[index].item_slot == 'misc'){
                              type = 'cosmetic'
                              if(bp_item_descs[index].name.endsWith(bp_items.names[i]) && bp_item_descs[index].name.startsWith('The ')){
                                bp_items.names[i] = bp_item_descs[index].name
                              }
                          }
                          else if(['primary', 'secondary', 'melee', 'building', 'pda', 'pda2'].includes(bp_item_descs[index].item_slot)){ 
                              if(item_skins.some((skin) => skin.name.includes(bp_items.names[i]))){ 
                                default_weapons.push({name: bp_items.names[i], image: bp_item_descs[index].image_url, classes: bp_item_descs[index].used_by_classes ,defindex: bp_items.defindexes[i]})
                              }
                              if(bp_item_descs[index].name.endsWith(bp_items.names[i]) && bp_item_descs[index].name.startsWith('The ')){
                                bp_items.names[i] = bp_item_descs[index].name
                              }
                              if(['Festive Huntsman', 'Festive Backburner', 'Festive Holy Mackerel', 'Festive Axtinguisher', 'Festive Ubersaw', 'Festive Ambassador', 'Festive Buff Banner', 'Festive Sandvich'].includes(bp_items.names[i])){
                                bp_items.names[i] = 'The ' + bp_items.names[i];
                              }
                              if(
                                ["Scattergun",	"Shortstop",	"Soda Popper", "Winger", "Sandman","Holy Mackerel", "Rocket Launcher",	"Black Box",	"Air Strike", "Shovel",	"Disciplinary", "Action", "Flame Thrower",	"Degreaser",	"Dragon's Fury", "Detonator",	"Scorch Shot", "Fire Axe",	"Powerjack",	"Back Scratcher", "Grenade Launcher",	"Loch-n-Load",	"Loose Cannon",	"Iron Bomber", "Stickybomb Launcher",	"Scottish Resistance", "Scotsman's Skullcutter",	"Claidheamh Mòr",	"Persian Persuader", "Minigun",	"Natascha","Brass Beast","Tomislav", "Family Business", "Rescue Ranger", "Wrench",	"Jag", "Crusader's Crossbow", "Medi Gun",	"Kritzkrieg	Quick-Fix", "Ubersaw", "Amputator", "Sniper Rifle",	"Bazaar Bargain", "SMG", "Kukri Shahanshah", "Revolver", "Knife","Spy-cicle", "Pistol", "Reserve Shooter", "Shotgun", "Panic Attack"]
                                .some((weapon) => bp_items.names[i].includes(weapon) && !bp_items.names[i].includes('Australium') && !bp_items.names[i].includes('Festive'))
                              ){
                                if(bp_items.names[i].startsWith('The ')){ bp_items.names[i] = bp_items.names[i].replace('The ', '')}
                                suggestions.push(
                                  {
                                    name: 'Festivized ' + bp_items.names[i], 
                                    type: 'weapon',
                                    image: [bp_item_descs[index].image_url], 
                                    classes: bp_item_descs[index]?.used_by_classes, 
                                    float_value: attributes,
                                    defindex: bp_items.defindexes[i], 
                                    method: 'bp-mixed',
                                    prices: bp_items.prices[i]
                                  }
                                )
                              }
                              type = 'weapon'
                          }
                          else if(bp_item_descs[index].item_class == 'no_entity' && bp_item_descs[index]?.item_slot == 'taunt'){
                            type = 'taunt'
                          }
                          else if(bp_item_descs[index].item_class == 'tool' || ['Tour of Duty Ticket', 'Squad Surplus Voucher'].includes(bp_item_descs[index].name)){
                              if(bp_items.names[i].includes('Strange Filter')){ type = 'tool strange filter'; method = 'bp-mixed' }
                              else if(bp_items.names[i].includes('Strange Part')){ type = 'tool strange part'; method = 'bp' }
                              else if(bp_items.names[i].includes(' Key')){ type = 'tool key'; method = 'bp-mixed' }
                              else if(bp_item_descs[index].name.includes('Paint Can') && bp_item_descs[index].hasOwnProperty("attributes")){
                                if(bp_item_descs[index].attributes[0]?.name == 'set item tint RGB'){ 
                                  rgb_tint.push(bp_item_descs[index].attributes[0]?.value)
                                  type = 'tool paint'; method = 'bp'
                                }
                              }
                              else { type = 'tool'; method = 'bp' }
                          }
                          else if(bp_item_descs[index].item_slot == 'action'){
                            type = 'action'; method = 'bp'
                          }
                          else if(bp_item_descs[index].item_class == 'supply_crate'){
                            type = 'crate'; method = 'bp-mixed'; 
                          }
                          else{
                            if(type == ''){ break; }
                          }

                          suggestions.push(
                            {
                              name: bp_items.names[i], 
                              type: type,
                              ...(type == 'crate') && {series: bp_items.prices[i].series},
                              ...(type == 'tool paint') && {rgb_tint: rgb_tint}, 
                              image: [bp_item_descs[index].image_url], 
                              classes: bp_item_descs[index]?.used_by_classes, 
                              float_value: attributes,
                              defindex: bp_items.defindexes[i], 
                              method: method,
                              prices: bp_items.prices[i]
                            }
                          )
                          break; 
                        }
                      }
                    }
                    
                    // loop over item schema & push taunts, cosmetics to type arrays (if not already in)
                    /* 
                    const schema_leftovers = item_schema.filter((item) => item?.item_slot == 'taunt')
                    for (const item of schema_leftovers) {
                      if(!suggestions.some((sug) => sug.defindex.includes(item.defindex))){
                        // push
                        console.log(item.name)
                      }
                    }
                    */

                    // remove single class shotguns

                    default_weapons =  Array.from(new Set(default_weapons.map(JSON.stringify))).map(JSON.parse);

                    if(market_items.length != 0){
                      const australiums = Array.from(new Set(suggestions.map(JSON.stringify))).map(JSON.parse).filter(
                        (sug) => sug.name.includes('Australium') && sug.type == 'weapon'
                      )
                      australiums.forEach(australium => {
                        let match = market_items.find((item) => item.market_hash_name.includes(australium.name) && item.image != null && item.image != 'null')
                        if(match != null || match != undefined){
                          suggestions = suggestions.filter(x => x.name !== australium.name);
                          australium.image = [match.image]
                          suggestions.push(australium)
                        }
                      });

                      const paints = Array.from(new Set(suggestions.map(JSON.stringify))).map(JSON.parse).filter(
                        (sug) => sug.image[0] == 'http://media.steampowered.com/apps/440/icons/paintcan.92b2bb1938cbb89c52bfba13fb2965f39e5a55d5.png' || sug.image[0] == 'http://media.steampowered.com/apps/440/icons/teampaint.9424700b08103164275efcaee9af46773f2cb34c.png'
                      )
                      paints.forEach(paint => {
                        let match = market_items.find((item) => item.market_hash_name == paint.name && item.image != null && item.image != 'null')
                        if(match != null || match != undefined){
                          paint.image = [match.image]
                          suggestions = suggestions.filter(x => x.name !== paint.name);
                          suggestions.push(paint)
                        }
                      })

                      suggestions = suggestions.filter(x => x.name !== 'Unusualifier');
                      market_items.filter(
                        (item) => item.market_hash_name.startsWith('Unusual Taunt: ') && item.market_hash_name.endsWith(' Unusualifier') && item.border_color.includes(item_attributes.Quality.Unusual.color)
                      ).forEach(item => {
                          let img = (item.image == 'null' || item.image == null) ? 'http://media.steampowered.com/apps/440/icons/unusualifier.f84395e47b1321524ab85c591fa2c213ea5fe031.png':item.image
                          suggestions.push(
                            {
                              name: item.market_hash_name, 
                              type: 'tool unusualifier', 
                              image: [img],
                              defindex: [9258], 
                              method: 'scm-mixed'
                            }
                          ) 
                      });

                      suggestions = suggestions.filter(x => x.name !== 'Strangifier');
                      market_items.filter(
                        (item) => item.market_hash_name.endsWith(' Strangifier') && !item.market_hash_name.includes('Chemistry Set') && item.border_color.includes('7D6D00')
                      ).forEach(item => {
                        let img = (item.image == 'null' || item.image == null) ? 'http://media.steampowered.com/apps/440/icons/strange_generic.c49007ba98593c7ac9fded38d2d61b1d2b4091b9.png':item.image
                        suggestions.push(
                          {
                            name: item.market_hash_name, 
                            type: 'tool strangifier', 
                            image: [img],
                            defindex: [5661,5721,5722,5723,5724,5725,5753,5754,5755,5756,5757,5758,5759,5783,5784,5804,6522], 
                            method: 'scm-mixed'
                          }
                        ) 
                      })

                      market_items.filter(
                        (item) => item.market_hash_name.endsWith(' Kit') && item.market_hash_name.includes('Killstreak') 
                      ).forEach(item => {
                        if(item.market_hash_name.includes('Professional')){
                          let img = (item.image == 'null' || item.image == null) ? 'https://community.akamai.steamstatic.com/economy/image/fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbfggXWAjxsTdNicTZCuCJCfMFpMg095Vq1Td5lgQ1Z7fmNGNlIlOUU_kJD61rpVu4W35m6sVnA4C3oe1QcQu-tdHHZrF4ZMYMQZfUUFwt4w/360fx360f':item.image
                          suggestions.push(
                            {
                              name: item.market_hash_name, 
                              type: 'tool kit', 
                              image: [img],
                              defindex: [], 
                              method: 'scm'
                            }
                          ) 
                        }
                        else if(item.market_hash_name.includes('Specialized')){
                          let img = (item.image == 'null' || item.image == null) ? 'https://community.akamai.steamstatic.com/economy/image/fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEbfggXWAjxsTdNicTZCuCJCfMFpNY095dQlzA4kgIoYOHiMzM3JQKUUaEIXaZr8Vy4WSNnvcVnUtKwo7oEeQrrt4bYc-57rMzzrEU/360fx360f':item.image
                          suggestions.push(
                            {
                              name: item.market_hash_name, 
                              type: 'tool kit', 
                              image: [img],
                              defindex: [], 
                              method: 'scm'
                            }
                          ) 
                        }
                        else {
                          let img = (item.image == 'null' || item.image == null) ? 'http://media.steampowered.com/apps/440/icons/professional_grease_basic_large.f99f65359f8b7a19c83b810ea986f67a1d907d86.png':item.image
                          suggestions.push(
                            {
                              name: item.market_hash_name, 
                              type: 'tool kit', 
                              image: [img],
                              defindex: [], 
                              method: 'scm'
                            }
                          ) 
                        }
                      })

                      for (let i = 0; i < item_skins.length; i++) {
                        const weapon = default_weapons.find((weap) => item_skins[i].name.includes(weap.name))
                        const skin_results = market_items.filter(function(item){
                          return item.market_hash_name.includes(item_skins[i].name) && !['Killstreak'].some(sub => item.market_hash_name.includes(sub))
                        })

                        let images = []
                        weapon_wears.forEach(wear => {
                          let match = skin_results.find((res) => res.market_hash_name.includes(wear) && res.image != null && !res.market_hash_name.includes('Festiv'))
                          if(match == undefined || match == null || match?.image == null){ images.push(weapon.image) }
                          else { images.push(match.image) }
                        });

                        suggestions.push(
                          {
                            name: item_skins[i].name, 
                            type: 'weapon skin', 
                            grade: item_skins[i].grade,
                            image: images, 
                            classes: weapon.classes, 
                            defindex: weapon.defindex, 
                            method: 'bp-mixed'
                          }
                        ) 
                      }

                      for (let i = 0; i < item_warpaints.length; i++) {
                        const warpaint_results = market_items.filter(function(item){
                          return item.market_hash_name.includes(item_warpaints[i].name + ' War Paint')
                        })

                        let images = []
                        weapon_wears.forEach(wear => {
                          let match = warpaint_results.find((res) => res.market_hash_name.includes(wear) && res.image != null)
                          if(match == undefined || match == null || match?.image == null){ images.push('https://steamcdn-a.akamaihd.net/apps/440/icons/paintkit_tool.4b545466ce72a20215f43f63a1f6cd9e5f3331c5.png') }
                          else { images.push(match.image) }
                        });

                        suggestions.push(
                          {
                            name: item_warpaints[i].name + ' War Paint', 
                            type: 'war paint', 
                            grade: item_warpaints[i].grade,
                            image: images, 
                            classes: null, 
                            defindex: null, 
                            method: 'bp-mixed'
                          }
                        ) 
                      }

                      const festivized_sugs = suggestions.filter((sug) => sug.name.startsWith('Festivized') && sug.type == 'weapon')
                      for (const fest of festivized_sugs) {
                        try {
                          const match = market_items.find((item) => item.market_hash_name.includes(String(fest.name).replace('Festivized', '')) && item.market_hash_name.includes('Festivized ') && !item.market_hash_name.includes('(') && !item.market_hash_name.includes('Australium') && item?.image != 'null')
                          fest.image = [match.image]
                          suggestions.push(fest)
                        } catch {}
                      }
                    }

                    item_suggestions = Array.from(new Set(suggestions.map(JSON.stringify))).map(JSON.parse);
                    resolve(Array.from(new Set(suggestions.map(JSON.stringify))).map(JSON.parse).length)
                }
            })
      })
  })
}

const stock_limits = {
  misc: 5,
  weapon: 3,
  tool: { ticket: 150, expander: 100, key: 4, other: 10 },
  taunt: { default: 6, new: 3},
  warpaint: 7,
  skin: 2
}

fetch_tf2_items()
.then(
  async function(suggestions_length){
    console.log(`[${new Date().getHours()+':'+new Date().getMinutes()}] item suggestions - created`)
    const instances = await Instance.find()
    const effects = await Unusual_Effect.find()
  },
  function(err){
    console.log(`[${new Date().getHours()+':'+new Date().getMinutes()}] item suggestions - failed to create`)
  }
)

module.exports = router;

// (cheap) buy_price < 10 keys < buy_price (expensive)

// buy tradable only & if there is difference in craftable and (un) take the cheaper pricing (= dont make difference)

// buy for slight overpay in contrast to actuall price
// set min and max tresholds for sell price (in %)... min (cheap 11% expensive 9%) default to (cheap 55% expensive 30%)
// approach each type section differently
async function get_item_prices( item ){
  return new Promise((resolve, reject) => {
      // for skins and warpaints use data from both scm & bp / or only one / skip update if no data available

  })
}

// upload update functions to GH (private repo)
// price updating functions run separatelly (local machine - to not slow down server)

async function get_key_price(){
  // run everyday at 0:00
}

async function scrape_skins() {
  return new Promise(async (resolve, reject) => {
    let savedSKINS = 0;
    const browser = await puppeteer.launch({})

    try{
      const page = await browser.newPage()
      await page.goto('https://wiki.teamfortress.com/wiki/Decorated')
      
      const skinDB = await Skins.find()
      let grades = require('../config/Items.json').Grades
  
      // skins 
      const tableLength = await page.$$eval('table.wikitable.collapsible.collapsed', divs => divs.length)
      for (let i = 0; i < tableLength; i++) {
        const eleLength = await page.$$eval(`#collapsibleTable${i} > tbody > tr`, divs => divs.length)
        for (let y = 2; y < eleLength + 1; y++) {
          const skinName = await page.$eval(`#collapsibleTable${i} > tbody > tr:nth-child(${y}) > td > b`, el => [el.textContent, el.parentElement.getAttribute('style')]);  
          if(skinDB.find((skin) => skin.name == skinName[0]) == undefined){
            let name = skinName[0]
            let grade = Object.keys(grades).find(key => grades[key] === skinName[1].substring(11,18))
            const newSkin = new Skins({
              name: name,
              grade: grade
            })
            await newSkin.save().then(() => { 
              savedSKINS += 1 
              config_setting.skins.push(newSkin)
            })  
          }
        }
      }  

      try{ browser.close() } catch{}
      resolve(savedSKINS)
    }catch{
      try{ browser.close() } catch{}
      reject(savedSKINS)
    }  
  })
}

async function scrape_warpaints() {
  return new Promise(async (resolve, reject) => {
    let savedWPs = 0;
    const browser = await puppeteer.launch({})

    try{
      const page = await browser.newPage()
      await page.goto('https://wiki.teamfortress.com/wiki/Decorated')
      
      // warpaints
      const warpaintDB = await Warpaints.find()
      const warpaints = await page.$$eval('.warpaint.item-grade', divs => divs.map(wp => [wp.textContent.replace('\n\t\t\t', ''), wp.classList[wp.classList.length - 1]]))
      
      warpaints.forEach(async (wp, i) => {
        if(warpaintDB.find((warpaint) => warpaint.name == wp[0]) == undefined){
          let name = wp[0]
          let grade = wp[1].charAt(0).toUpperCase() + wp[1].slice(1)
          const new_wp = new Warpaints({
            name: name,
            grade: grade
          })
          await new_wp.save().then(() => { 
            savedWPs += 1
            config_setting.warpaints.push(new_wp)
          })
  
        }
      });
      
      try{ browser.close() } catch{}
      resolve(savedWPs)  
    } catch {
      try{ browser.close() } catch{}
      reject(savedWPs)
    }
  })
}

async function scrape_particles() {
  return new Promise(async (resolve, reject) => {
    const browser = await puppeteer.launch({})
    let savedParticles = 0;
    const particleDB = await Unusual_Effect.find()

    try{
      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0') // should be latest version
      await page.goto('https://backpack.tf/developer/particles')

      const table = await page.$$eval("#page-content > div:nth-child(3) > div > div > div > table > tbody > tr", trs => { 
        return trs.slice(1).map(tr => tr.querySelector('td:nth-child(2)').textContent.trim()) 
      })

      for (const effect of table) {
        let effect_id = effect.split(' ')[0];
        let effect_name = effect.replace(effect_id + ' ', '')
        effect_id = effect_id.replace('#', '')        
        
        if(particleDB.some(particle => { return particle.name == effect_name })){
          
        } else {
          const new_particle = new Unusual_Effect({
            ID: effect_id,
            name: effect_name
          })
          await new_particle.save().then(() => { 
            savedParticles += 1 
            config_setting.unusual_particles.push(new_particle)
          })
        }
      }
      
      try{ browser.close() } catch{}
      resolve(savedParticles)  
    } catch {
      try{ browser.close() } catch{}
      reject(savedParticles)
    }
  })
}
