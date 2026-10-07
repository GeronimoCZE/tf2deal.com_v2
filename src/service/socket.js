import { io as clientio } from "socket.io-client";
import localEmitter from "../emitter.js";
import * as app from '../app.js'
import { log } from "console";
import { createSettingsSocket } from "./settings_socket.js";


const bot_socket = { timestamp: 0, socket: null}
const item_socket = { timestamp: 0, socket: null}

let sio = null;

// Trade offer updates go to a room per user ("user:<steamid>"), so every open tab gets them, and a page reload or
// a second tab can no longer make the user "disappear" (before, app.users kept one socket id per user and dropped
// the user as soon as any of their tabs closed, so the "accepted" update had nowhere to go).
const user_room = (steamid) => `user:${String(steamid)}`

// bot statuses can come as text ("accepted") or as the numeric state from app.js trade_states ("3")
const STATES = { 1: 'error', 2: 'sent', 3: 'accepted', 4: 'declined counter', 5: 'declined expired', 6: 'error wrong offer', 7: 'declined', 8: 'error missing items', 9: 'pending', 10: 'declined', 11: 'declined trade hold' }
const normalize_status = (status) => {
    if(typeof status == 'number' || /^\d+$/.test(String(status ?? ''))){ return STATES[Number(status)] || status }
    return typeof status == 'string' ? status.trim() : status
}

// an update that arrived while the user had no page open (e.g. mid page-load) is kept briefly and shown when they connect
const FINAL = ['accepted', 'declined', 'canceled', 'expired', 'invalid', 'error']
const missed = new Map() // steamid -> { data, time }
const MISSED_TTL = 10 * 60 * 1000

const send_offer_update = (partner, res) => {
    if(!sio || partner === undefined || partner === null){ return }
    const steamid = String(partner)
    const status = normalize_status(res?.status)
    const data = { status, offer: res?.offer ? { ...res.offer, ...(res.offer.status !== undefined ? { status: normalize_status(res.offer.status) } : {}) } : null }
    const room = sio.sockets.adapter.rooms.get(user_room(steamid))
    if(room && room.size){
        sio.to(user_room(steamid)).emit('sentOfferChanged', data)
        missed.delete(steamid)
    } else if(FINAL.includes(String(data.offer?.status ?? status).split(' ')[0])){
        missed.set(steamid, { data, time: Date.now() })
    }
}

const createSocket = (io) => {
    sio = io;
    createSettingsSocket(io); // namespace /settings: other apps change site settings live (see SETTINGS.md)
    
    io.on('connection', async socket => {
        socket = await identify_socket(socket);

        console.log(socket.handshake?.type, socket.id);

        if(socket.handshake?.type === "user"){
            const steamid = socket.data.steamid
            const last = missed.get(steamid)
            if(last){
                missed.delete(steamid)
                if(Date.now() - last.time < MISSED_TTL){ socket.emit('sentOfferChanged', last.data) }
            }

            socket.on('getTradeOffer', () => {
                if(socket.data.steamid && bot_socket.socket){
                    bot_socket.socket.emit('getTradeOffer', socket.data.steamid)
                }
            })
        } 

        socket.on('disconnect', () => {
            if(socket.handshake.type == "bot_socket"){ bot_socket.socket = null }
            else if(socket.handshake.type == "item_socket"){ item_socket.socket = null }
            else {
                const steamid = socket.data?.steamid;

                if(steamid){
                    console.log('User disconected');
                    // forget the user only when their last tab is gone
                    const entry = app.users.get(String(steamid))
                    entry?.sockets?.delete(socket.id)
                    if(!entry?.sockets?.size){
                        app.users.delete(String(steamid))
                    } else if(entry.socket == socket.id){
                        entry.socket = Array.from(entry.sockets).pop()
                    }
                }
            }
        })
    })
}

setTimeout(() => {
    const items_io = clientio.connect(`${process.env.ITEMS_ENDPOINT}?server=web&server_token=${process.env.SERVER_TOKEN}&server_secret=${process.env.SERVER_SECRET}`);
    const bots_io = clientio.connect(`${process.env.BOTS_ENDPOINT}?server=web&server_token=${process.env.SERVER_TOKEN}&server_secret=${process.env.SERVER_SECRET}`);
    
    items_io.on('connect', () => {
        item_socket.timestamp = Date.now();
        item_socket.socket = items_io;
        console.log('Successfully connected! (items socket)');
    });

    items_io.on('item_status', (data) => {
      console.log(data);
      
    })


    items_io.on('disconnect', () => {
        item_socket.timestamp = Date.now();
        item_socket.socket = null;
        console.log('Items socket disconnected.');
    });

    bots_io.on('connect', () => {
        bot_socket.timestamp = Date.now();
        bot_socket.socket = bots_io;
        console.log('Successfully connected! (bots socket)');
    });

    bots_io.on('fp_data', (data) => {
      app.fp_data.bots = data?.bots || [];
      app.fp_data.items = data?.items || 0;
      app.fp_data.trades = data?.trades || 0;
    })

    bots_io.on('get_activeTraders', () => {
        console.log(Array.from(app.users)
            .filter(([_, value]) => value.trade)
            .map(([key]) => key));
        
        bots_io.emit('activeTraders', Array.from(app.users)
            .filter(([_, value]) => value.trade)
            .map(([key]) => key)
        )
    })

    bots_io.on('TradeOffer', (res) => {
        try {            
            send_offer_update(res?.partner, res)
        } catch (error) {
            console.error('Error occurred while handling TradeOffer:', error);
        }
    })

    bots_io.on('sentOfferChanged', (res) => {
        try {
            send_offer_update(res?.partner, res)
        } catch (error) {
            console.error('Error occurred while handling sentOfferChanged:', error);
        }
    })

    bots_io.on('offer_status', (offers) => {
        if(Array.isArray(offers)){
            for (const offer of offers) {
                console.log(offer)
                if(offer?.steamid !== undefined && offer?.steamid !== null){
                    sio.to(user_room(offer.steamid)).emit('TradeOffer', offer?.offer ? offer?.offer : null)
                }
            }
        }
    })

    bots_io.on('disconnect', () => {
        bot_socket.timestamp = Date.now();
        bot_socket.socket = null;

        app.fp_data.bots = [];
        app.fp_data.items = 0;
        app.fp_data.trades = 0;
    
        console.log('Bots socket disconnected.');
    });
}, 10000);

// Who the browser socket belongs to comes from the signed-in session (app.js shares the express session with
// socket.io). The steamid the page sends in `auth` is ignored, so nobody can listen to another user's room.
const identify_socket = (socket) => {
    const steamid = socket?.request?.user?.steamid;
    if(steamid){ socket.data.steamid = String(steamid) }

    if(steamid){
        socket.handshake.type = "user"
        const id = String(steamid)
        socket.join(user_room(id))
        // one entry per user with all their open tabs; `socket` stays the newest one for older code
        const entry = app.users.get(id) || { socket: socket.id, trade: false }
        entry.sockets = entry.sockets || new Set()
        entry.sockets.add(socket.id)
        entry.socket = socket.id
        app.users.set(id, entry)
    }

    return socket;
}

export {
    createSocket,
    bot_socket,
    item_socket
}