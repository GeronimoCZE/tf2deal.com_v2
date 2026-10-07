import * as app from '../app.js'
import User from '../model/User.js'
import { notification_model } from '../model/Notification.js'

// Notifications for the bell in the nav (js/plugins/notifications.js, model/Notification.js).
//   notify({ type, vars, link })            -> everyone
//   notify({ to: steamid, type, vars, link }) -> one user
// Open pages get it live over socket.io: everyone gets `notification` with the notification itself; a single
// user only gets a `notifications:refresh` nudge in their room, and their page loads it from the API with
// their session (the socket's steamid isn't verified, so nothing personal is sent over it).

const KEEP_DAYS = 60
const LIMIT = 20

const public_view = (n) => ({
    id: String(n._id),
    type: n.type,
    vars: n.vars || {},
    text: n.text || '',
    link: n.link || '',
    personal: Boolean(n.to),
    created: n.created
})

const notify = async ({ to = null, type, vars = {}, text = '', link = '' }) => {
    try {
        const doc = await new notification_model({ to: to ? String(to) : null, type, vars, text, link, created: Date.now() }).save()
        const io = app.io
        if(io){
            if(doc.to){ io.to(`user:${doc.to}`).emit('notifications:refresh') }
            else { io.emit('notification', public_view(doc.toObject())) }
        }
        return doc
    } catch (error) {
        console.log('notify failed', error.message)
        return null
    }
}

// newest first: everyone's + this user's
const list = async (steamid) => {
    const since = Date.now() - KEEP_DAYS * 86400000
    const to = steamid ? { $in: [null, String(steamid)] } : null
    const items = await notification_model.find({ to, created: { $gte: since } }).sort({ created: -1 }).limit(LIMIT).lean()
    return items.map(public_view)
}

const seen_at = async (steamid) => {
    const user = await User.findOne({ steamid: String(steamid) }, { notifications_seen: 1 }).lean()
    return Number(user?.notifications_seen) || 0
}

const mark_seen = async (steamid, time = Date.now()) => {
    await User.updateOne({ steamid: String(steamid) }, { $set: { notifications_seen: time } })
    return time
}

export { notify, list, seen_at, mark_seen, public_view }
