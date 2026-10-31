'use strict';

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const app = require('../app');
const { connect } = require('../database');
const User = require('../models/user');
const Task = require('../models/task');

const uri = process.env.TEST_MONGODB_URI;
const databaseName = `mp3_test_${randomUUID().replaceAll('-', '')}`;
const deadline = '2026-11-03T12:00:00.000Z';
let base;
let server;

describe('API integration with a real transaction-capable database', {
    skip: uri ? false : 'Set TEST_MONGODB_URI to run database integration tests.'
}, () => {
    before(async () => {
        // Always override the URI database: tests never clean an application database.
        await connect(uri, { dbName: databaseName });
        server = await new Promise(resolve => {
            const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        });
        base = `http://127.0.0.1:${server.address().port}/api`;
    });
    beforeEach(async () => {
        await User.deleteMany({});
        await Task.deleteMany({});
    });
    afterEach(async () => { await assertRelationships(); });
    after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        if (mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    });

    async function request(path, method = 'GET', body, status = 200, headers) {
        const response = await fetch(base + path, {
            method,
            headers: headers || (body === undefined ? {} : { 'Content-Type': 'application/json' }),
            body: body === undefined ? undefined : headers ? body : JSON.stringify(body)
        });
        const json = await response.json();
        assert.equal(response.status, status, JSON.stringify(json));
        assert.deepEqual(Object.keys(json).sort(), ['data', 'message']);
        assert.equal(typeof json.message, 'string');
        if (status >= 400) assert.equal(json.data, null);
        return json.data;
    }
    async function user(name = 'Alice', extra = {}) {
        return request('/users', 'POST', { name, email: `${name}@example.com`, ...extra }, 201);
    }
    async function task(extra = {}) {
        return request('/tasks', 'POST', { name: 'Task', deadline, ...extra }, 201);
    }
    function query(values) {
        return '?' + new URLSearchParams(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
    }
    async function snapshot() {
        return JSON.stringify({ users: await User.find().select('+__v').sort('_id').lean(),
            tasks: await Task.find().select('+__v').sort('_id').lean() });
    }
    async function assertRelationships() {
        const users = await User.find().lean();
        const tasks = await Task.find().lean();
        const byUser = new Map(users.map(value => [value._id.toString(), value]));
        const byTask = new Map(tasks.map(value => [value._id.toString(), value]));
        for (const owner of users) {
            assert.equal(new Set(owner.pendingTasks).size, owner.pendingTasks.length);
            for (const id of owner.pendingTasks) {
                const value = byTask.get(id);
                assert.ok(value, 'Pending reference must exist');
                assert.equal(value.completed, false);
                assert.equal(value.assignedUser, owner._id.toString());
            }
        }
        for (const value of tasks) {
            if (!value.assignedUser) {
                assert.equal(value.assignedUserName, 'unassigned');
                continue;
            }
            const owner = byUser.get(value.assignedUser);
            assert.ok(owner, 'Assigned user must exist');
            assert.equal(value.assignedUserName, owner.name);
            assert.equal(owner.pendingTasks.includes(value._id.toString()), !value.completed);
        }
    }

    test('creation defaults, read-only fields, single reads, and readiness', async () => {
        assert.deepEqual(await request(''), { status: 'ready' });
        const suppliedId = new mongoose.Types.ObjectId().toString();
        const owner = await user('Alice', { _id: suppliedId, dateCreated: '2000-01-01' });
        assert.notEqual(owner._id, suppliedId);
        assert.deepEqual(owner.pendingTasks, []);
        assert.ok(Date.parse(owner.dateCreated) > Date.parse('2026-01-01'));
        const value = await task();
        assert.equal(value.description, '');
        assert.equal(value.completed, false);
        assert.equal(value.assignedUser, '');
        assert.equal(value.assignedUserName, 'unassigned');
        assert.equal('__v' in value, false);
        assert.deepEqual(await request(`/users/${owner._id}`), owner);
        assert.deepEqual(await request(`/tasks/${value._id}`), value);
    });

    test('PUT replaces optional fields while preserving IDs and creation dates', async () => {
        const owner = await user();
        const value = await task({ assignedUser: owner._id, description: 'old', completed: true });
        const replaced = await request(`/tasks/${value._id}`, 'PUT', { name: 'New', deadline, dateCreated: '2000-01-01' });
        assert.equal(replaced._id, value._id);
        assert.equal(replaced.dateCreated, value.dateCreated);
        assert.equal(replaced.description, '');
        assert.equal(replaced.completed, false);
        assert.equal(replaced.assignedUser, '');
        await request(`/tasks/${value._id}`, 'PUT', { name: 'Task', deadline, assignedUser: owner._id });
        const changed = await request(`/users/${owner._id}`, 'PUT', { name: 'New owner', email: owner.email });
        assert.deepEqual(changed.pendingTasks, []);
        assert.equal(changed.dateCreated, owner.dateCreated);
        assert.equal((await request(`/tasks/${value._id}`)).assignedUser, '');
    });

    test('task assignment, completion, reopening, reassignment and unassignment', async () => {
        const a = await user('A');
        const b = await user('B');
        const value = await task({ assignedUser: a._id });
        assert.equal(value.assignedUserName, a.name);
        assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, [value._id]);
        await request(`/tasks/${value._id}`, 'PUT', { name: 'Task', deadline, assignedUser: a._id, completed: true });
        assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, []);
        await request(`/tasks/${value._id}`, 'PUT', { name: 'Task', deadline, assignedUser: b._id, completed: true });
        assert.deepEqual((await request(`/users/${b._id}`)).pendingTasks, []);
        await request(`/tasks/${value._id}`, 'PUT', { name: 'Task', deadline, assignedUser: b._id, completed: false });
        assert.deepEqual((await request(`/users/${b._id}`)).pendingTasks, [value._id]);
        const unassigned = await request(`/tasks/${value._id}`, 'PUT', {
            name: 'Task', deadline, assignedUser: '', assignedUserName: 'Ignored when unassigned'
        });
        assert.equal(unassigned.assignedUserName, 'unassigned');
    });

    test('user replacement moves tasks, releases removed tasks and renames completed assignments', async () => {
        const a = await user('A');
        const b = await user('B');
        const moved = await task({ assignedUser: a._id });
        const removed = await task({ assignedUser: b._id });
        const completed = await task({ assignedUser: b._id, completed: true });
        const changed = await request(`/users/${b._id}`, 'PUT', {
            name: 'Renamed', email: b.email, pendingTasks: [moved._id.toUpperCase(), moved._id]
        });
        assert.deepEqual(changed.pendingTasks, [moved._id]);
        assert.deepEqual((await request(`/users/${a._id}`)).pendingTasks, []);
        assert.equal((await request(`/tasks/${removed._id}`)).assignedUser, '');
        assert.equal((await request(`/tasks/${completed._id}`)).assignedUserName, 'Renamed');
        const c = await user('C', { pendingTasks: [moved._id] });
        assert.equal((await request(`/tasks/${moved._id}`)).assignedUser, c._id);
        assert.deepEqual((await request(`/users/${b._id}`)).pendingTasks, []);
    });

    test('invalid requests and duplicate emails leave every document unchanged', async () => {
        const owner = await user();
        const value = await task({ assignedUser: owner._id });
        const completed = await task({ completed: true });
        const missing = new mongoose.Types.ObjectId().toString();
        const initial = await snapshot();
        const cases = [
            ['/users', { name: 'B', email: owner.email }, 400],
            ['/users', { name: 'B' }, 400],
            ['/tasks', { name: 'T', deadline, completed: 'false' }, 400],
            ['/tasks', { name: 'T', deadline: 'bad' }, 400],
            ['/tasks', { name: 'T', deadline, assignedUser: 'bad' }, 400],
            ['/tasks', { name: 'T', deadline, assignedUser: missing }, 404],
            ['/tasks', { name: 'T', deadline, assignedUser: owner._id, assignedUserName: 'Wrong' }, 400],
            ['/users', { name: 'B', email: 'b', pendingTasks: [missing] }, 404],
            ['/users', { name: 'B', email: 'b', pendingTasks: [missing, completed._id] }, 400]
        ];
        for (const [path, body, status] of cases) {
            await request(path, 'POST', body, status);
            assert.equal(await snapshot(), initial);
        }
        await request(`/users/${owner._id}`, 'PUT', { name: 'B', email: 'b', pendingTasks: ['bad'] }, 400);
        await request(`/tasks/${value._id}`, 'PUT', { name: 'Task' }, 400);
        assert.equal(await snapshot(), initial);
        await request(`/users/${owner._id}`, 'PUT', { name: owner.name, email: owner.email, pendingTasks: [value._id] });
    });

    test('missing URL IDs take precedence over invalid bodies', async () => {
        for (const kind of ['users', 'tasks']) {
            for (const id of ['bad', new mongoose.Types.ObjectId().toString()]) {
                await request(`/${kind}/${id}`, 'GET', undefined, 404);
                await request(`/${kind}/${id}`, 'PUT', {}, 404);
                await request(`/${kind}/${id}`, 'PUT', '{', 404, { 'Content-Type': 'application/json' });
                await request(`/${kind}/${id}`, 'DELETE', undefined, 404);
            }
        }
    });

    test('single-resource select works and unrelated query parameters are ignored', async () => {
        for (const [kind, value] of [['users', await user()], ['tasks', await task()]]) {
            assert.deepEqual(await request(`/${kind}/${value._id}` + query({ select: { name: 1, _id: 0 } })), { name: value.name });
            assert.deepEqual(await request(`/${kind}/${value._id}?where=bad&sort=bad&skip=bad&limit=bad&count=bad`), value);
            const excluded = await request(`/${kind}/${value._id}` + query({ select: { _id: 0 } }));
            assert.equal('_id' in excluded, false);
            await request(`/${kind}/${value._id}?select=bad`, 'GET', undefined, 400);
        }
    });

    test('collection filtering, sorting, projection, pagination and independent count', async () => {
        const first = await task({ name: 'Alpha' });
        await task({ name: 'Beta', completed: true });
        const third = await task({ name: 'Gamma' });
        assert.deepEqual(await request('/tasks' + query({ where: { _id: { $in: [first._id, third._id] } },
            sort: { name: -1 }, skip: 1, limit: 1, select: { name: 1, _id: 0 } })), [{ name: 'Alpha' }]);
        assert.equal(await request('/tasks' + query({ where: { completed: false }, skip: 50, limit: 1, count: true })), 2);
        assert.deepEqual(await request('/users' + query({ where: { name: 'Nobody' } })), []);
        assert.equal(await request('/tasks' + query({ where: { name: 'Nobody' }, count: true })), 0);
        for (const suffix of ['?where=bad', '?where=null', '?where={"_id":"bad"}', '?where={"$bad":1}',
            '?where={"name":{"$bad":1}}', '?where={"name":{"$regex":"["}}',
            '?count=true&limit=-1', '?skip=1.2', '?sort={"name":0}', '?select={"name":1,"completed":0}', '?limit=1&limit=2']) {
            await request('/tasks' + suffix, 'GET', undefined, 400);
        }
    });

    test('tasks default to 100 results and users remain unlimited', async () => {
        await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `Task ${i}`, deadline })));
        await User.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `U${i}`, email: `u${i}` })));
        assert.equal((await request('/tasks')).length, 100);
        assert.equal((await request('/tasks?limit=0')).length, 105);
        assert.equal((await request('/users')).length, 105);
        assert.equal(await request('/tasks?count=true'), 105);
    });

    test('deletions clean pending and completed relationships', async () => {
        const owner = await user();
        const value = await task({ assignedUser: owner._id });
        const completed = await task({ assignedUser: owner._id, completed: true });
        await request(`/tasks/${value._id}`, 'DELETE');
        assert.deepEqual((await request(`/users/${owner._id}`)).pendingTasks, []);
        await request(`/tasks/${value._id}`, 'GET', undefined, 404);
        await request(`/tasks/${value._id}`, 'DELETE', undefined, 404);
        const pending = await task({ assignedUser: owner._id });
        await request(`/users/${owner._id}`, 'DELETE');
        for (const id of [pending._id, completed._id]) assert.equal((await request(`/tasks/${id}`)).assignedUser, '');
        await request(`/users/${owner._id}`, 'GET', undefined, 404);
    });

    test('URL-encoded inputs, malformed JSON and OPTIONS responses', async () => {
        const owner = await request('/users', 'POST', new URLSearchParams({ name: 'Form', email: 'form', pendingTasks: '[]' }).toString(),
            201, { 'Content-Type': 'application/x-www-form-urlencoded' });
        const value = await request('/tasks', 'POST', new URLSearchParams({ name: 'Form task', deadline,
            completed: 'false', assignedUser: owner._id }).toString(), 201, { 'Content-Type': 'application/x-www-form-urlencoded' });
        assert.equal(value.completed, false);
        await request('/users', 'POST', '{', 400, { 'Content-Type': 'application/json' });
        const response = await fetch(base + '/tasks', { method: 'OPTIONS' });
        assert.equal(response.status, 204);
        assert.equal(await response.text(), '');
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        await request('/missing', 'GET', undefined, 404);
        await request('/users/%E0%A4%A', 'GET', undefined, 400);
    });

    test('a failure after relationship writes rolls the transaction back', async t => {
        const owner = await user();
        const initial = await snapshot();
        t.mock.method(Task, 'create', async () => { throw new Error('Injected database failure'); });
        await request('/tasks', 'POST', { name: 'Task', deadline, assignedUser: owner._id }, 500);
        assert.equal(await snapshot(), initial);
        t.mock.restoreAll();
    });

    test('user deletion failure rolls back task unassignment and version changes', async t => {
        const owner = await user();
        await task({ assignedUser: owner._id });
        await task({ assignedUser: owner._id, completed: true });
        const initial = await snapshot();
        t.mock.method(User, 'deleteOne', async () => { throw new Error('Injected database failure'); });
        await request(`/users/${owner._id}`, 'DELETE', undefined, 500);
        assert.equal(await snapshot(), initial);
        t.mock.restoreAll();
    });

    test('transient write conflicts retry the whole transaction without duplicate tasks', async t => {
        const owner = await user();
        const original = Task.create;
        let attempts = 0;
        t.mock.method(Task, 'create', function (...args) {
            if (attempts++ === 0) {
                const error = new mongoose.mongo.MongoServerError({ message: 'Injected write conflict', code: 112 });
                error.addErrorLabel('TransientTransactionError');
                throw error;
            }
            return original.apply(this, args);
        });
        const value = await task({ assignedUser: owner._id });
        assert.equal(attempts, 2);
        assert.equal(await Task.countDocuments(), 1);
        assert.deepEqual((await request(`/users/${owner._id}`)).pendingTasks, [value._id]);
        t.mock.restoreAll();
    });

    test('concurrent duplicate-email creation produces one resource', async () => {
        const responses = await Promise.all(Array.from({ length: 6 }, () => fetch(base + '/users', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Same', email: 'same' })
        })));
        assert.equal(responses.filter(response => response.status === 201).length, 1);
        assert.equal(responses.filter(response => response.status === 400).length, 5);
        await Promise.all(responses.map(response => response.arrayBuffer()));
        assert.equal(await User.countDocuments(), 1);
    });

    test('concurrent competing owners leave one consistent assignment', async () => {
        const owners = await Promise.all(['A', 'B', 'C'].map(name => user(name)));
        const value = await task();
        await Promise.all(owners.map(owner => request(`/users/${owner._id}`, 'PUT', {
            name: owner.name, email: owner.email, pendingTasks: [value._id]
        })));
        await assertRelationships();
        assert.equal((await User.find().lean()).filter(owner => owner.pendingTasks.includes(value._id)).length, 1);
    });

    test('rename races with both pending and completed task creation', async () => {
        const owner = await user();
        await Promise.all([
            request(`/users/${owner._id}`, 'PUT', { name: 'Renamed', email: owner.email }),
            ...Array.from({ length: 8 }, (_, i) => task({ assignedUser: owner._id, completed: i % 2 === 0 }))
        ]);
        await assertRelationships();
    });

    test('deletion races with completed-task creation without orphaning assignments', async () => {
        const owner = await user();
        const responses = await Promise.all([
            fetch(base + `/users/${owner._id}`, { method: 'DELETE' }),
            ...Array.from({ length: 8 }, () => fetch(base + '/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Task', deadline, assignedUser: owner._id, completed: true })
            }))
        ]);
        assert.equal(responses[0].status, 200);
        for (const response of responses.slice(1)) assert.ok([201, 404].includes(response.status));
        await Promise.all(responses.map(response => response.arrayBuffer()));
        await assertRelationships();
    });

    test('completion races with whole-user replacement', async () => {
        const owner = await user();
        const value = await task({ assignedUser: owner._id });
        await Promise.all([
            request(`/tasks/${value._id}`, 'PUT', { name: 'Task', deadline, assignedUser: owner._id, completed: true }),
            request(`/users/${owner._id}`, 'PUT', { name: 'Renamed', email: owner.email })
        ]);
        await assertRelationships();
    });
});
