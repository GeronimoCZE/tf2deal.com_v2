import mongoose from "mongoose";

const Pure = mongoose.Schema({
    name: {
        type: String
    },
    value: {
        type: Number
    },
    currency: {
        type: String
    },
    difference: {
        type: Number
    },
    last_update: {
        type: Number
    },
    value_high: {
        type: Number
    },
    value_raw: {
        type: Number
    }
})

export const pure_model = mongoose.model('tf2_pure', Pure);