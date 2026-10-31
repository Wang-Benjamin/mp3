'use strict';

const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError } = require('../lib/errors');
const { resourceId, userBody, taskBody } = require('../lib/validation');
const { publicDocument } = require('../lib/query');

const UNASSIGNED = { assignedUser: '', assignedUserName: 'unassigned' };

async function transaction(work) {
    const session = await mongoose.startSession();
    try {
        return await session.withTransaction(() => work(session), {
            readPreference: 'primary',
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            timeoutMS: 15000
        });
    } finally { await session.endSession(); }
}

async function requireResource(Model, id, session) {
    const document = await Model.findById(id).session(session).lean();
    if (!document) throw new ApiError(404, `${Model.modelName} not found.`);
    return document;
}

async function touchUsers(ids, session) {
    // A real write protects completed-task assignments and no-op list changes too.
    // Every operation involving a user shares this conflict point with rename/delete.
    for (const id of [...new Set(ids.filter(Boolean))].sort()) {
        const result = await User.updateOne({ _id: id }, { $inc: { __v: 1 } }, { session });
        if (result.matchedCount !== 1) throw new Error('An assignment owner is missing.');
    }
}

async function saveUser(body, form, rawId) {
    const id = rawId === undefined ? new mongoose.Types.ObjectId().toString() : resourceId(rawId, 'User');
    return transaction(async session => {
        const previous = rawId === undefined ? null : await requireResource(User, id, session);
        const values = userBody(body, form);
        if (await User.exists({ email: values.email, _id: { $ne: id } }).session(session)) {
            throw new ApiError(400, 'That email is already in use.');
        }
        const tasks = await Task.find({ _id: { $in: values.pendingTasks } })
            .select('_id completed assignedUser').session(session).lean();
        if (tasks.some(task => task.completed)) throw new ApiError(400, 'pendingTasks cannot contain completed tasks.');
        if (tasks.length !== values.pendingTasks.length) throw new ApiError(404, 'A pending task was not found.');

        const moved = new Map();
        for (const task of tasks) {
            if (task.assignedUser && task.assignedUser !== id) {
                const ids = moved.get(task.assignedUser) || [];
                ids.push(task._id.toString());
                moved.set(task.assignedUser, ids);
            }
        }
        await touchUsers([...(previous ? [id] : []), ...moved.keys()], session);
        const requested = new Set(values.pendingTasks);
        const removed = (previous?.pendingTasks || []).filter(taskId => !requested.has(taskId));
        if (removed.length) {
            await Task.updateMany({ _id: { $in: removed }, assignedUser: id }, { $set: UNASSIGNED }, { session });
        }
        for (const [owner, ids] of moved) {
            await User.updateOne({ _id: owner }, { $pull: { pendingTasks: { $in: ids } } }, { session });
        }
        if (previous) {
            await User.updateOne({ _id: id }, { $set: values }, { session, runValidators: true });
        } else {
            await User.create([{ _id: id, ...values }], { session });
        }
        if (values.pendingTasks.length) {
            await Task.updateMany({ _id: { $in: values.pendingTasks } }, {
                $set: { assignedUser: id, assignedUserName: values.name }
            }, { session });
        }
        // Completed tasks stay assigned and must receive the current owner name.
        await Task.updateMany({ assignedUser: id }, { $set: { assignedUserName: values.name } }, { session });
        return publicDocument(await requireResource(User, id, session));
    });
}

async function saveTask(body, form, rawId) {
    const id = rawId === undefined ? new mongoose.Types.ObjectId().toString() : resourceId(rawId, 'Task');
    return transaction(async session => {
        const previous = rawId === undefined ? null : await requireResource(Task, id, session);
        const values = taskBody(body, form);
        if (values.assignedUser) {
            const owner = await User.findById(values.assignedUser).session(session).lean();
            if (!owner) throw new ApiError(404, 'Assigned user not found.');
            if (values.assignedUserName !== undefined && values.assignedUserName !== owner.name) {
                throw new ApiError(400, 'assignedUserName must match the assigned user’s name.');
            }
            values.assignedUserName = owner.name;
        } else { values.assignedUserName = UNASSIGNED.assignedUserName; }

        await touchUsers([previous?.assignedUser, values.assignedUser], session);
        if (previous?.assignedUser) {
            await User.updateOne({ _id: previous.assignedUser }, { $pull: { pendingTasks: id } }, { session });
        }
        if (values.assignedUser) {
            const change = values.completed ? { $pull: { pendingTasks: id } } : { $addToSet: { pendingTasks: id } };
            await User.updateOne({ _id: values.assignedUser }, change, { session });
        }
        if (previous) {
            await Task.updateOne({ _id: id }, { $set: values }, { session, runValidators: true });
        } else {
            await Task.create([{ _id: id, ...values }], { session });
        }
        return publicDocument(await requireResource(Task, id, session));
    });
}

async function deleteUser(rawId) {
    const id = resourceId(rawId, 'User');
    return transaction(async session => {
        await requireResource(User, id, session);
        await touchUsers([id], session);
        await Task.updateMany({ assignedUser: id }, { $set: UNASSIGNED }, { session });
        await User.deleteOne({ _id: id }, { session });
        return { _id: id };
    });
}

async function deleteTask(rawId) {
    const id = resourceId(rawId, 'Task');
    return transaction(async session => {
        const task = await requireResource(Task, id, session);
        await touchUsers([task.assignedUser], session);
        if (task.assignedUser) {
            await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: id } }, { session });
        }
        await Task.deleteOne({ _id: id }, { session });
        return { _id: id };
    });
}

module.exports = { saveUser, saveTask, deleteUser, deleteTask };
