'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

router.get('/', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) throw new Error('Database is unavailable.');
        await mongoose.connection.db.command({ ping: 1 }, { timeoutMS: 2000 });
        res.json({ message: 'OK', data: { status: 'ready' } });
    } catch {
        res.status(503).json({ message: 'The service is not ready. Please try again.', data: null });
    }
});

module.exports = router;
