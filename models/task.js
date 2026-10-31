'use strict';

const mongoose = require('mongoose');
const { ID_PATTERN } = require('../lib/validation');

const taskSchema = new mongoose.Schema({
    name: { type: String, required: true, validate: value => value.trim().length > 0 },
    description: { type: String, default: '' },
    deadline: { type: Date, required: true },
    completed: { type: Boolean, default: false },
    assignedUser: { type: String, default: '', validate: value => value === '' || ID_PATTERN.test(value) },
    assignedUserName: { type: String, default: 'unassigned' },
    dateCreated: { type: Date, default: Date.now, immutable: true },
    __v: { type: Number, default: 0, select: false }
}, { bufferCommands: false, autoCreate: false, autoIndex: false, strictQuery: false });

taskSchema.index({ assignedUser: 1 });
module.exports = mongoose.model('Task', taskSchema);
