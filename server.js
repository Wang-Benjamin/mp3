'use strict';

require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const app = require('./app');
const { connect } = require('./database');

async function start() {
    await connect(process.env.MONGODB_URI);
    const port = process.env.PORT || 3000;
    const server = await new Promise((resolve, reject) => {
        const listener = app.listen(port, '0.0.0.0', () => resolve(listener));
        listener.once('error', reject);
    });
    console.log(`Server listening on port ${server.address().port}`);
    let stopping = false;
    async function shutdown() {
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => {
            server.closeAllConnections();
            process.exit(1);
        }, 20000);
        deadline.unref();
        try {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await mongoose.disconnect();
            clearTimeout(deadline);
        } catch { process.exitCode = 1; }
    }
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return server;
}

if (require.main === module) {
    start().catch(async error => {
        console.error('Server startup failed. Check MONGODB_URI, Atlas access, and required indexes.', {
            error: error.name, code: error.code
        });
        await mongoose.disconnect();
        process.exitCode = 1;
    });
}

module.exports = { start };
