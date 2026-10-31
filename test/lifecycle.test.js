'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { connect } = require('../database');
const app = require('../app');

test('missing database configuration fails without starting the service', async () => {
    await assert.rejects(connect(''), /MONGODB_URI must be configured/);
    assert.equal(mongoose.connection.readyState, 0);
});

test('an unreachable database fails within the connection timeout', async () => {
    await assert.rejects(connect('mongodb://127.0.0.1:1/mp3_unreachable', { serverSelectionTimeoutMS: 100 }));
    assert.equal(mongoose.connection.readyState, 0);
});

test('disconnected readiness and database reads fail promptly with safe envelopes', async () => {
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const readiness = await fetch(base + '/api');
        assert.equal(readiness.status, 503);
        assert.equal((await readiness.json()).data, null);
        const response = await fetch(base + '/api/users', { signal: AbortSignal.timeout(2000) });
        assert.equal(response.status, 500);
        const error = await response.json();
        assert.deepEqual(Object.keys(error).sort(), ['data', 'message']);
        assert.equal(error.data, null);
        assert.doesNotMatch(error.message, /mongoose|mongodb|buffer|connection/i);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('server starts ready and terminates gracefully on SIGTERM', {
    skip: process.env.TEST_MONGODB_URI ? false : 'Set TEST_MONGODB_URI to test the server lifecycle.'
}, async () => {
    const databaseName = `mp3_test_${randomUUID().replaceAll('-', '')}`;
    // Construct a URI pointing only at this test's generated database.
    const uri = process.env.TEST_MONGODB_URI.replace(/(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/[^?]*)?(\?.*)?$/, `$1/${databaseName}$2`);
    const child = spawn(process.execPath, ['server.js'], {
        cwd: require('node:path').resolve(__dirname, '..'),
        env: { ...process.env, MONGODB_URI: uri, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const exited = once(child, 'exit');
    try {
        const address = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
            child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited: ${stderr}`)); });
            child.stdout.on('data', () => {
                const match = stdout.match(/Server listening on port (\d+)/);
                if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
            });
        });
        assert.equal((await fetch(address + '/api')).status, 200);
        child.kill('SIGTERM');
        const [code, signal] = await Promise.race([
            exited,
            new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new Error('Graceful shutdown timed out')), 5000);
                timer.unref();
            })
        ]);
        assert.equal(code, 0, stderr);
        assert.equal(signal, null);
    } finally {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
        const cleanup = await mongoose.createConnection(process.env.TEST_MONGODB_URI, { dbName: databaseName }).asPromise();
        await cleanup.dropDatabase();
        await cleanup.close();
    }
});
