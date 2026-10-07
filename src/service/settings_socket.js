// Live settings over socket.io, namespace /settings (same server and port as the website).
//
// Who can connect (handshake `auth`):
//   other apps:   { server_token: SERVER_TOKEN, server_secret: SERVER_SECRET, app: 'bot server' }   read + write
//   read-only:    { read_token: SETTINGS_READ_TOKEN, app: 'stats' }                               read (only if set in .env)
//   admin panel:  { admin_token }  (made by GET /api/admin/settings, see service/settings.js)      read + write
//
// Events (all payloads are JSON):
//   server -> client  'settings:init'     { settings, version }                  right after connecting
//   server -> client  'settings:changed'  { settings, changed, version, updated, by }   after every change, to every client
//   client -> server  'settings:get'      (ack) -> { status: 'ok', settings, version }
//   client -> server  'settings:update'   (patch, ack) -> { status: 'ok', settings, changed } | { status: 'error', message, errors }
//   client -> server  'settings:clients'  (ack) -> { status: 'ok', clients: [...] }   who is connected (admin panel)
//
// Website visitors get only the public part on the default namespace: 'site_settings' { trading, announcement, version }.
// Full guide with examples: SETTINGS.md

import localEmitter from '../emitter.js'
import * as settings from './settings.js'

const MAX_UPDATES = 30          // per client ...
const UPDATE_WINDOW = 10 * 1000 // ... per 10 seconds

let nsp = null

const authenticate = (socket) => {
  const auth = socket.handshake?.auth || {}
  const name = String(auth.app || socket.handshake?.query?.app || '').trim().slice(0, 60)

  if(settings.safe_equal(auth.server_token, process.env.SERVER_TOKEN) && settings.safe_equal(auth.server_secret, process.env.SERVER_SECRET)){
    return { kind: 'app', name: name || 'app', can_write: true }
  }
  if(auth.admin_token){
    const admin = settings.verify_admin_token(auth.admin_token)
    if(admin){ return { kind: 'admin', name: 'admin panel', can_write: true } }
  }
  if(settings.safe_equal(auth.read_token, process.env.SETTINGS_READ_TOKEN)){
    return { kind: 'app', name: name || 'read-only app', can_write: false }
  }
  return null
}

export const clients = () => nsp ? Array.from(nsp.sockets.values()).map((s) => ({
  id: s.id,
  kind: s.data.client.kind,
  name: s.data.client.name,
  can_write: s.data.client.can_write,
  address: s.handshake.address,
  since: s.data.since
})) : []

export const createSettingsSocket = (io) => {
  nsp = io.of('/settings')

  nsp.use((socket, next) => {
    const client = authenticate(socket)
    if(!client){
      const err = new Error('unauthorized')
      err.data = { message: 'Send { server_token, server_secret } (or read_token / admin_token) in the socket auth.' }
      return next(err)
    }
    socket.data.client = client
    socket.data.since = Date.now()
    socket.data.updates = []
    next()
  })

  nsp.on('connection', (socket) => {
    const client = socket.data.client
    console.log(`settings socket: ${client.kind} "${client.name}" connected (${socket.id})`)

    socket.emit('settings:init', { settings: settings.get(), version: settings.get().version })
    nsp.emit('settings:clients_changed', { count: nsp.sockets.size })

    const reply = (ack, data) => { if(typeof ack == 'function'){ ack(data) } }

    socket.on('settings:get', (ack) => {
      reply(ack, { status: 'ok', settings: settings.get(), version: settings.get().version })
    })

    socket.on('settings:update', async (patch, ack) => {
      if(typeof patch == 'function'){ ack = patch; patch = undefined }
      if(!client.can_write){ return reply(ack, { status: 'error', message: 'This connection is read-only.' }) }

      const now = Date.now()
      socket.data.updates = socket.data.updates.filter((t) => now - t < UPDATE_WINDOW)
      if(socket.data.updates.length >= MAX_UPDATES){
        return reply(ack, { status: 'error', message: 'Too many updates, slow down.' })
      }
      socket.data.updates.push(now)

      reply(ack, await settings.update(patch, { kind: client.kind, name: client.name }))
    })

    socket.on('settings:clients', (ack) => {
      reply(ack, { status: 'ok', clients: clients() })
    })

    socket.on('disconnect', () => {
      console.log(`settings socket: ${client.kind} "${client.name}" disconnected`)
      nsp.emit('settings:clients_changed', { count: nsp.sockets.size })
    })
  })

  localEmitter.on('settings:changed', (event) => {
    nsp.emit('settings:changed', {
      settings: event.settings,
      changed: event.changed,
      version: event.version,
      updated: event.updated,
      by: event.by
    })
    if(event.public_changed){
      io.emit('site_settings', settings.public_view())
    }
  })

  // first load from the DB (in case a client connected before it finished)
  localEmitter.on('settings:loaded', (all) => {
    nsp.emit('settings:init', { settings: all, version: all.version })
    io.emit('site_settings', settings.public_view())
  })

  return nsp
}
