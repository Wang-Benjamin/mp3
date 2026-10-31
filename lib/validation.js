'use strict';

const { ApiError } = require('./errors');
const ID_PATTERN = /^[a-f\d]{24}$/i;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resourceId(value, label) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new ApiError(404, `${label} not found.`);
    return value.toLowerCase();
}

function referenceId(value, field) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw new ApiError(400, `${field} must contain a valid ID.`);
    }
    return value.toLowerCase();
}

function stringField(value, field, required = false) {
    if (typeof value !== 'string' || (required && value.trim().length === 0)) {
        throw new ApiError(400, `${field} must be ${required ? 'a nonempty' : 'a'} string.`);
    }
    return value;
}

function requireBody(body) {
    if (!isObject(body)) throw new ApiError(400, 'The request body must be an object.');
}

function userBody(body, form = false) {
    requireBody(body);
    const name = stringField(body.name, 'name', true);
    const email = stringField(body.email, 'email', true);
    let pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (form && typeof pendingTasks === 'string') {
        try { pendingTasks = JSON.parse(pendingTasks); } catch { /* Report the field error below. */ }
    }
    if (!Array.isArray(pendingTasks)) throw new ApiError(400, 'pendingTasks must be an array.');
    pendingTasks = [...new Set(pendingTasks.map(id => referenceId(id, 'pendingTasks')))];
    return { name, email, pendingTasks };
}

function taskBody(body, form = false) {
    requireBody(body);
    const name = stringField(body.name, 'name', true);
    const rawDeadline = body.deadline;
    if ((typeof rawDeadline !== 'string' && typeof rawDeadline !== 'number') ||
        (typeof rawDeadline === 'string' && !rawDeadline.trim()) ||
        (typeof rawDeadline === 'number' && !Number.isFinite(rawDeadline))) {
        throw new ApiError(400, 'deadline must be a valid date.');
    }
    // Match Mongoose's support for epoch milliseconds encoded as form strings.
    const deadline = new Date(typeof rawDeadline === 'string' && /^[+-]?\d{5,}$/.test(rawDeadline)
        ? Number(rawDeadline) : rawDeadline);
    if (Number.isNaN(deadline.getTime())) throw new ApiError(400, 'deadline must be a valid date.');
    const description = body.description === undefined ? '' : stringField(body.description, 'description');
    let completed = body.completed === undefined ? false : body.completed;
    if (form && (completed === 'true' || completed === 'false')) completed = completed === 'true';
    if (typeof completed !== 'boolean') throw new ApiError(400, 'completed must be a boolean.');
    const assignedUser = body.assignedUser === undefined || body.assignedUser === ''
        ? '' : referenceId(body.assignedUser, 'assignedUser');
    const assignedUserName = body.assignedUserName === undefined
        ? undefined : stringField(body.assignedUserName, 'assignedUserName');
    return { name, description, deadline, completed, assignedUser, assignedUserName };
}

module.exports = { ID_PATTERN, isObject, resourceId, userBody, taskBody };
