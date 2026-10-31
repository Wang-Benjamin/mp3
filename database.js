'use strict';

const mongoose = require('mongoose');
const User = require('./models/user');
const Task = require('./models/task');

async function connect(uri, options = {}) {
    if (!uri) throw new Error('MONGODB_URI must be configured.');
    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        timeoutMS: 10000,
        ...options
    });
    try {
        // Create required indexes without dropping existing ones or rewriting data.
        await User.createCollection();
        await Task.createCollection();
        await User.createIndexes();
        await Task.createIndexes();
    } catch (error) {
        await mongoose.disconnect();
        throw error;
    }
}

module.exports = { connect };
