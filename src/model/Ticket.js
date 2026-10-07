import mongoose from "mongoose";

const Message = mongoose.Schema({
    from: { type: String, enum: ['user', 'admin'], required: true },
    text: { type: String, required: true },
    created: { type: Number, required: true }
}, { _id: false })

const Ticket = mongoose.Schema({
    steamid: { type: String, required: true },
    name: { type: String, default: '' }, // steam name when the ticket was created
    title: { type: String, required: true }, // category picked in the form
    status: { type: String, default: 'open' }, // open = waiting for us, answered = waiting for the user, closed
    messages: { type: [Message], default: [] },
    created: { type: Number, required: true },
    updated: { type: Number, required: true }
})

Ticket.index({ steamid: 1, updated: -1 });

export const ticket_model = mongoose.model('tickets', Ticket);
