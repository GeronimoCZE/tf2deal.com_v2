import mongoose from "mongoose";

const Warpaint = mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    grade: {
        type: String,
        required: true
    }
})

export const warpaint_model = mongoose.model('weaponwarpaints', Warpaint);