'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resourceId, userBody, taskBody } = require('../lib/validation');
const { collectionQuery, projection, publicDocument } = require('../lib/query');

test('body validation preserves strict JSON types and canonicalizes reference lists', () => {
    const id = 'ABCDEF012345678901234567';
    assert.deepEqual(userBody({ name: 'A', email: 'a', pendingTasks: [id, id.toLowerCase()] }), {
        name: 'A', email: 'a', pendingTasks: [id.toLowerCase()]
    });
    for (const body of [null, [], {}, { name: 2, email: 'a' }, { name: ' ', email: 'a' },
        { name: 'A', email: null }, { name: 'A', email: 'a', pendingTasks: id },
        { name: 'A', email: 'a', pendingTasks: ['bad'] }]) {
        assert.throws(() => userBody(body), { status: 400 });
    }
    assert.throws(() => resourceId('bad', 'User'), { status: 404 });
});

test('task defaults, deadline parsing, and form values', () => {
    const task = taskBody({ name: 'Task', deadline: 1800000000000 });
    assert.equal(task.deadline.getTime(), 1800000000000);
    assert.equal(task.completed, false);
    assert.equal(task.description, '');
    assert.equal(task.assignedUser, '');
    assert.equal(taskBody({ name: 'Task', deadline: '1800000000000', completed: 'false' }, true).completed, false);
    assert.deepEqual(userBody({ name: 'A', email: 'a', pendingTasks: '[]' }, true).pendingTasks, []);
    for (const change of [{ deadline: null }, { deadline: true }, { deadline: '' }, { deadline: 'bad' },
        { completed: 'false' }, { completed: 0 }, { description: [] }, { assignedUser: null }]) {
        assert.throws(() => taskBody({ name: 'Task', deadline: '2026-11-01', ...change }), { status: 400 });
    }
});

test('collection query defaults and combinations', () => {
    assert.equal(collectionQuery({}, 100).limit, 100);
    assert.equal(collectionQuery({}, 0).limit, 0);
    assert.deepEqual(collectionQuery({ where: '{"completed":false}', sort: '{"name":-1}',
        select: '{"name":1,"_id":0}', skip: '2', limit: '0', count: 'true' }, 100), {
        where: { completed: false }, sort: { name: -1 }, select: { name: 1, _id: 0 }, skip: 2, limit: 0, count: true
    });
});

test('invalid collection parameters are rejected even when count is true', () => {
    for (const query of [{ where: '{' }, { where: 'null' }, { where: '[]' }, { sort: '{"name":0}' },
        { sort: '[]' }, { select: '{"name":2}' }, { select: '{"name":1,"email":0}' },
        { skip: '-1' }, { skip: '0.5' }, { limit: '"2"' }, { count: '1' }, { limit: ['1', '2'] }]) {
        assert.throws(() => collectionQuery({ count: 'true', ...query }, 100), { status: 400 });
    }
    assert.deepEqual(projection({ select: '{"name":1,"_id":0}' }), { name: 1, _id: 0 });
    assert.deepEqual(projection({ select: '{"name":0,"_id":1}' }), { name: 0, _id: 1 });
});

test('public documents do not expose internal versions', () => {
    assert.deepEqual(publicDocument({ name: 'A', __v: 3 }), { name: 'A' });
});
