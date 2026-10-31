'use strict';

const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const resources = require('../services/resources');
const resourceRouter = require('./resources');

module.exports = function routes(app) {
    const router = express.Router();
    router.use('/', require('./home'));
    router.use('/users', resourceRouter(User, { save: resources.saveUser, remove: resources.deleteUser }));
    router.use('/tasks', resourceRouter(Task, { save: resources.saveTask, remove: resources.deleteTask, limit: 100 }));
    app.use('/api', router);
};
