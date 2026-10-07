import mongoose from "mongoose";

const UnusualEffect = mongoose.Schema({
    ID: {
        type: String
    },
    name: {
        type: String
    },
    active: {
        type: String,
        default: "true"
    }
})

export const effect_model = mongoose.model('Unusual_Effects', UnusualEffect);