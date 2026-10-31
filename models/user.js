'use strict';

const mongoose = require('mongoose');
const { ID_PATTERN } = require('../lib/validation');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, validate: value => value.trim().length > 0 },
    email: { type: String, required: true, validate: value => value.trim().length > 0 },
    pendingTasks: {
        type: [String],
        default: [],
        validate: values => values.every(value => ID_PATTERN.test(value)) && new Set(values).size === values.length
    },
    dateCreated: { type: Date, default: Date.now, immutable: true },
    __v: { type: Number, default: 0, select: false }
}, { bufferCommands: false, autoCreate: false, autoIndex: false, strictQuery: false });

userSchema.index({ email: 1 }, { unique: true });
module.exports = mongoose.model('User', userSchema);
