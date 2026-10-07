import mongoose from "mongoose";

const Skin = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    grade: {
        type: String,
        required: true
    }
})

export const skin_model = mongoose.model('weaponskins', Skin);