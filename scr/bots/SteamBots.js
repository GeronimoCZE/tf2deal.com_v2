const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamTotp = require('steam-totp');
const SteamID = require('steamid');

const fetch = require('node-fetch')
const path = require("path");
const EventEmitter = require('events');

const Pure = require('../config/Pure.json');
const Unusual_Effect = require('../model/dev/_itemParticle');
const EOfferFilter = require('steam-tradeoffer-manager/resources/EOfferFilter');
const { trade_offer_obj } = require('../fn');
const { client } = require('../api/redis');

require('dotenv').config({ path: path.resolve(__dirname + '/config/', './.env') });

// refill pure from warhouse to all bots at once (reduce conf checks)

class Trade_Offer {
  constructor(id, state, tradeBot, partner, userSide, siteSide, expire){
    this.id = id;
    this.state = state;
    this.tradeBot = tradeBot;
    this.partner = partner;
    this.userSide = userSide;
    this.siteSide = siteSide;
    this.created = Date.now();
    this.willCanceled = Date.now() + expire;
  }
  remove(){
    try{
      trade_offers.delete(this.partner)
    } catch{}
  }
}

class TradeBot extends EventEmitter{
    constructor(logOnOptions) {
      super();
      this.clientLogons = 0;
      this.communityLogons = 0;
      this.logOnOptions = logOnOptions;

      this.type = logOnOptions.accountType;
      this.index = logOnOptions.accountID;
      this.status = { steamClient: false, steamCommunity: false, steamInventory: false }
      this.steamid = undefined;
      this.tradeURL = undefined;
      this.name = undefined;

      this.friends = new Map();
      
      this.pendingTradeOffers = new Map(); // list of trade offer ids    
      this.itemsLimit = {Total: 1500};
      this.itemsSlots = 3000; // make sure all bots have maxed out inv!
      this.allItems = undefined;
      this.items = []; // Tradable items only!
      this.pureLimit = {Total: 1500, Key: 500, Ref: 800, Rec: 100, Scrap: 100};
      this.pure = {Total: undefined, Key: [], Ref: [], Rec: [], Scrap: []}
      
      this.steamJoined = undefined;
      this.steamLevel = undefined;
      this.client = new SteamUser();
      this.community = new SteamCommunity();
      this.manager = new TradeOfferManager({
        steam: this.client,
        community: this.community,
        language: 'en',
        pollInterval: 2000,
        cancelTime: 600000, // 10 mins
        pendingCancelTime: 150000 // time trade offer can await confirmation
      });

      this.community_log = undefined;
  
      this.logOn(logOnOptions);

      setTimeout(() => {
        if(this.status.steamClient == true){
          this.logOnCommunity(this.logOnOptions)
        }
      }, 5000);

      setInterval(() => {
        for (let [key, value] of this.friends) {
          if(value.remove <= Date.now()){
            try {
              this.client.removeFriend(key)
              this.friends.delete(key)
            } catch (error) {}
          }
        }
      }, 45000);

      this.logOff = function() {
        this.client.logOff()
      }

      const self = this;

      this.client.on('loggedOn', () => {
          
        this.status.steamClient = true;
        this.clientLogons += 1;

        if(logOnOptions != undefined){
          this.client.setPersona(SteamUser.EPersonaState.Online, `tf2deal.com / #${logOnOptions.accountID}`);
        } else {
          this.client.setPersona(SteamUser.EPersonaState.Online);
        }
        
        if(this.steamLevel == undefined){
          this.client.getSteamLevels([this.client.steamID.getSteamID64()], (err, users) => {
            if(err == null){
              this.steamLevel = Object.values(users)[0];
            } else {

            }
          })
        }
        // this.client.gamesPlayed(440);
        if(this.steamid == undefined & this.client.steamID.getSteamID64() != undefined){
          this.steamid = this.client.steamID.getSteamID64();
          try{
            // save already in db model
            fetch(`https://api.steampowered.com/ISteamUser/getPlayerSummaries/v1/?key=822B9C17E98DD8C57532F14A33507B4B&steamids=${this.steamid}`)
            .then((res) => { return res.json()} )
            .then((json) => {
              this.steamJoined = json.response.players.player[0].timecreated;
            })
          } catch {}
          if(BotsSteamIDs.find(sid => sid == this.steamid) == undefined){
            BotsSteamIDs.push(this.steamid)
          }
        }
        if(this.tradeURL == undefined){
          this.client.getTradeURL((err, TradeURL) => {
            if(err == null){
              this.tradeURL = TradeURL.url;
            }
          })
        }
    
        this.emit(`logged`)
        if(this.items == ''){
          this.loadInventory()
        }
      
        /* setInterval(() => {
          this.manager.doPoll()
          console.log('polled') // !important for emiting events faster (default 30s)
        }, 3000) */
      });

      this.client.on('webSession', (sessionid, cookies) => {
        this.manager.setCookies(cookies);
        /* this.manager.getOffers(1000, (err, sent, received) => {
          if(err == null){
            console.log(sent)
          } else{ console.log(err) }
        }) */
        this.name = this.client.accountInfo.name;
      });

      this.client.setOption('promtSteamGuardCode', true);

      this.client.on('friendRelationship', function(SteamID, relationship){
        if(
          relationship == SteamUser.EFriendRelationship.RequestRecipient ||
          relationship == SteamUser.EFriendRelationship.RequestInitiator
        ){
          self.client.addFriend(SteamID, (err, personaname) => {
            self.friends.set(SteamID, { remove: Date.now() + 1000*60*10 })
          })

          self.client.chat.sendFriendMessage(SteamID, `Hello, I'm an automated trading bot! You can interact with me through commands. \nFor more visit https://tf2deal.com/about#bots-table \n\nTo sell an item type:`)
          self.client.chat.sendFriendMessage(SteamID, `/code !sell [item name]`)
          self.client.chat.sendFriendMessage(SteamID, `\n To buy an item type:`)
          self.client.chat.sendFriendMessage(SteamID, `/code !buy [item name]`)
        }
      })

      this.client.chat.on('friendMessage', (message) => {
        // ignore if already in que / trade

        if(message.message.startsWith('!sell')){
          if(message.message == '!sell'){

          }
          const item = message.message.replace('!sell ', '')
        }
        else if(message.message.startsWith('!buy')){
          if(message.message == '!buy'){

          }
          const item = message.message.replace('!buy ', '')
        }
        else{

        }
      })

      this.client.on('error', (e) => { // = logon error
        if(e.eresult == SteamUser.EResult.RateLimitExceeded){
        }
        this.emit('offline')
        this.status.steamClient = false;
      });

      this.client.on('disconnected', () => {
        this.client.gamesPlayed([])
        this.client.setPersona(SteamUser.EPersonaState.Offline);
        this.status.steamClient = false;
        this.emit('offline')
      });

      this.client.on('steamGuard', (e) => {
        this.emit('steamGuard')
        this.status.steamClient = false;
      });

      this.community.on('sessionExpired', this.client.webLogOn) // + remove event listeners

      this.manager.on('error', (e) => {
        
      });
      this.manager.on('newOffer', (offer) => {
        const partner = `[U:${offer.partner.universe}:${offer.partner.accountid}]`
        offer.decline((err) => { 
          try{
            this.client.chat.sendFriendMessage(partner, `Thank you for your trade offer. Sadly I don't accept any incoming trade offers... :steamsad:\n \n However you can visit https://tf2deal.com/ and trade with me here! :steamhappy: \n Everything is fast and fully automated.`)
          } catch{}
        })
      });

      this.manager.on('sentOfferChanged', (offer, oldState) => {
        this.emit('tradeOfferChange', offer.id, offer.state, new SteamID(`[U:${offer.partner.universe}:${offer.partner.accountid}]`).getSteamID64())
        if(offer.state == 11){
          offer.decline()
        }
        if(![2,9].includes(offer.state)){
          this.pendingTradeOffers.delete(offer.id)
        }
      });

      setInterval(() => {
        if(this.status.steamClient == false){
          this.logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(logOnOptions.sharedSecret, undefined)
          this.logOn(this.logOnOptions)
          setTimeout(() => {
            if(this.status.steamClient == true){
              this.logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(logOnOptions.sharedSecret, undefined)
              this.logOnCommunity(this.logOnOptions)
            }
          }, 4000);
        }        
        else{
          if(this.status.steamCommunity == false){
            this.logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(logOnOptions.sharedSecret, undefined)
            this.logOnCommunity(this.logOnOptions)
          }
        }
      }, 20000);
    }

    // interval to eleminate too much instances of client events

    logOnCommunity(logOnOptions){
      const communityOptions = {
        "accountName": logOnOptions.accountName,
        "password": logOnOptions.password,
        "steamguard": SteamTotp.generateAuthCode(logOnOptions.sharedSecret),
        "twoFactorCode": SteamTotp.generateAuthCode(logOnOptions.sharedSecret), // only required if logging in with a Steam Guard app code
        "captcha": "value of prompted captcha", // only required if you have been prompted with a CAPTCHA
        "disableMobile": true
      }

      if(this.communityLogons < 1){
        this.community.login(communityOptions, (err, sessionID, cookies, steamguard, oAuthToken) => { 
          if(err == null){
            this.communityLogons += 1;
            this.setup()
            this.manager.getOffers(1, (err, sent, received) => {
              if(err == null){
                sent.forEach(TradeOffer => {
                  const created = new Date(toString(TradeOffer.created)).getTime()
                  const now = Date.now()
                  const partner = new SteamID(`[U:${TradeOffer.partner.universe}:${TradeOffer.partner.accountid}]`).getSteamID64()
                  if(now - created < this.manager.cancelTime + this.manager.pendingCancelTime && trade_offers.get(partner) == undefined && partner != null && partner != undefined){
                    trade_offers.set(
                      partner,
                      new Trade_Offer(
                        TradeOffer.id, TradeOffer.state, 
                        {id: this.index, name: this.name, steamJoined: this.steamJoined, steamLevel: this.steamLevel, steamid: this.steamid}, 
                        partner, TradeOffer.itemsToReceive, TradeOffer.itemsToGive, (750000 - (now - created))
                      )
                    )  
                  }
                })
              }
            })
            this.status.steamCommunity = true;
            this.community.startConfirmationChecker(60000, logOnOptions.identitySecret);
            this.community.on('confKeyNeeded', function(tag, callback) {
              var time = Math.floor(Date.now() / 1000);
              callback(null, time, SteamTotp.getConfirmationKey(logOnOptions.identitySecret, time, tag));
            });
            this.community.on('newConfirmation', function(confirmation ) {
              // console.log(confirmation)
            })
            this.community.on('confirmationAccepted', function(confirmation ) {
              // console.log(confirmation)
            });
            this.community.on('debug', function(dbg) {
              if(this.community_log != `${logOnOptions.accountID}# trade bot - ${dbg}`){
                this.community_log = `${logOnOptions.accountID}# trade bot - ${dbg}`
                console.log(`[${new Date().getHours()+':'+new Date().getMinutes()}] ${logOnOptions.accountID}# trade bot - ${dbg}`)
              }
            })
          } else {
            this.status.steamCommunity = false;
            if(this.community_log != `${this.index}# trade bot - offline`){
              this.community_log = `${this.index}# trade bot - offline`
              console.log(`[${new Date().getHours()+':'+new Date().getMinutes()}] ${this.index}# trade bot - offline`)
            }
          }
        })
      }
    }
    logOn(logOnOptions) {
        this.client.logOn(logOnOptions);
	  }

    async setup(){
      // put those into function that will be manually called when first logged into system 
      this.community.uploadAvatar(`${require.main.path}/public/img/group-icon.png`, 'png', (err, url) => {})
      this.community.joinGroup(process.env.STEAM_GROUP_ID);
    }

    relogOn(logOnOptions){
      this.client.logOn(logOnOptions);
    }

    addBotsToFriends(){
      for(const sid of BotsSteamIDs){
        this.community.addFriend(sid)
      }
    }

    async sendItemsOver(){
      // sends items to an online bot with enough space to create an offer with items from multiple bots
    }
    // Define sendTradeOffer function
    async sendTradeOffer(partnerTradeURL, itemsToOffer, pureToOffer, itemsToReceive, pureToReceive) {
      return new Promise((resolve, reject) => {
        const tradeOffer = this.manager.createOffer(partnerTradeURL);

        // Add items to offer and receive
        tradeOffer.addMyItems(itemsToOffer)
        tradeOffer.addTheirItems(itemsToReceive)

        // Set trade message
        tradeOffer.setMessage(`Here is your trade from tf2deal.com. Please, make sure items match your order. Then enjoy your items!`);
        // Send trade offer
        tradeOffer.send((err, status) => {
          if (err) {
            reject(err.cause);
          } 
          else if(tradeOffer.escrowEnds != null){
            tradeOffer.cancel((err) => { reject('You have a Trade Hold!') })
          }
          else {
            resolve(tradeOffer);
            if(![1,8].includes(tradeOffer.state)){
              this.pendingTradeOffers.set(tradeOffer.id, '')

              trade_offers.set(
                new SteamID(`[U:${tradeOffer.partner.universe}:${tradeOffer.partner.accountid}]`).getSteamID64(),
                new Trade_Offer(
                  tradeOffer.id, tradeOffer.state, 
                  {id: this.index, name: this.name, steamJoined: this.steamJoined, steamLevel: this.steamLevel, steamid: this.steamid}, 
                  new SteamID(`[U:${tradeOffer.partner.universe}:${tradeOffer.partner.accountid}]`).getSteamID64(), itemsToReceive, itemsToOffer, 600000
                )
              )
            }
          }
        });
      });
    }
    
    async loadInventory (){
      const appid = 440;
      const contextid = 2;
      fetch(`https://api.steamapis.com/steam/inventory/${this.steamid || this.client.steamID.getSteamID64()}/${appid}/${contextid}?api_key=${process.env.API_KEY_STEAM_APIS}`)
          .then((res) => {  
            return res.json() 
          })
          .then(async(jsonResponse) => {
    
            /* const output = jsonResponse.assets.filter(function (obj) {
              return approvedClassids.indexOf(obj.classid) !== -1;
            }); */

            if(jsonResponse.assets != undefined){ 
              if(jsonResponse.assets.length != 0 ){
                this.allItems = jsonResponse.assets.length;
                for(let asset of jsonResponse.assets){
                  try{
                    let asset_desc = jsonResponse.descriptions.find((desc) => desc.classid == asset.classid && desc.instanceid == asset.instanceid);
                    if(asset_desc != undefined){
                      // filter params
                      delete asset.contextid;
                      delete asset.amount;
                      asset.name = asset_desc.market_hash_name;
                      asset.quality = asset_desc.tags.find((quality) => quality.category == 'Quality').localized_tag_name || "None";
                      asset.type = asset_desc.tags.find((type) => type.category == 'Type').localized_tag_name || "None";
                      asset.image = asset_desc.icon_url;
                      asset.tradable = asset_desc.tradable;
                      asset.price = Math.floor(Math.random() * (1000 - 1 + 1) + 1);
                      asset.description = asset_desc.descriptions; 
                      asset.tags = asset_desc.tags;
                      if(asset_desc.tags.find((quality) => quality.category == 'Quality').localized_tag_name == 'Unusual'){
                        let name = asset_desc.descriptions.find((obj) => obj.color === "ffd700").value
                        name = name.replace('★ Unusual Effect: ', '')
                        asset.effect = name || undefined;
                        try{
                          let effect = await Unusual_Effect.findOne({name: name})
                          asset.effect_id = (effect != null) ? effect.ID : undefined;
                        } catch{
                          asset.effect_id = undefined
                        }
                      } else {
                        asset.effect = undefined;
                        asset.effect_id = undefined
                      }
                    }
                    else{
                      asset.description = []
                    }
                  } catch {
                    asset.description = []
                  }
                };

                this.pure.Key = jsonResponse.assets.filter(item => item.classid == Pure.Key.classid).map(a => Object({assetid: a.assetid, inTrade: false}));
                this.pure.Ref = jsonResponse.assets.filter(item => item.classid == Pure.Ref.classid).map(a => Object({assetid: a.assetid, inTrade: false}));
                this.pure.Rec = jsonResponse.assets.filter(item => item.classid == Pure.Rec.classid).map(a => Object({assetid: a.assetid, inTrade: false}));
                this.pure.Scrap = jsonResponse.assets.filter(item => item.classid == Pure.Scrap.classid).map(a => Object({assetid: a.assetid, inTrade: false}));
                this.pure.Total = this.pure.Key.length + this.pure.Ref.length + this.pure.Rec.length + this.pure.Scrap.length;

                // -> removes all Pure and untradable items
                jsonResponse.assets = jsonResponse.assets.filter(function(item) {
                  return item.tradable === 1 && item.classid !== Pure.Key.classid && item.classid !== Pure.Ref.classid && item.classid !== Pure.Rec.classid && item.classid !== Pure.Scrap.classid;
                });
                this.items = jsonResponse.assets; 
                itemsAvailable += jsonResponse.assets.length;
                this.status.steamInventory = true;
              }
              else{
                // no items in inventory
              }
            }
            else{
              // no items in inventory
            }
          })
          .catch(err => {
            return false;
          });
    }
  }

  class Warhouse extends EventEmitter{
    
  } 

  module.exports = {TradeBot, Warhouse};
