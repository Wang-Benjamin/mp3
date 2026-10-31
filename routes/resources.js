'use strict';

const express = require('express');
const { ApiError } = require('../lib/errors');
const { resourceId } = require('../lib/validation');
const { list, projection, publicDocument, executeRead } = require('../lib/query');

module.exports = function resourceRouter(Model, { save, remove, limit = 0 }) {
    const router = express.Router();
    const parseBody = [express.urlencoded({ extended: true }), express.json()];
    const isForm = req => Boolean(req.is('application/x-www-form-urlencoded'));
    router.get('/', async (req, res) => {
        res.json({ message: 'OK', data: await list(Model, req.query, limit) });
    });
    router.post('/', ...parseBody, async (req, res) => {
        res.status(201).json({ message: `${Model.modelName} created.`, data: await save(req.body, isForm(req)) });
    });
    router.get('/:id', async (req, res) => {
        const id = resourceId(req.params.id, Model.modelName);
        const select = projection(req.query);
        const document = await executeRead(Model.findById(id).select(select).maxTimeMS(10000).lean());
        if (!document) throw new ApiError(404, `${Model.modelName} not found.`);
        res.json({ message: 'OK', data: publicDocument(document) });
    });
    router.put('/:id', async (req, res, next) => {
        // Before body parsing: an unknown URL resource wins over a malformed body.
        const id = resourceId(req.params.id, Model.modelName);
        if (!await Model.exists({ _id: id }).maxTimeMS(10000)) {
            throw new ApiError(404, `${Model.modelName} not found.`);
        }
        next();
    }, ...parseBody, async (req, res) => {
        res.json({ message: `${Model.modelName} updated.`, data: await save(req.body, isForm(req), req.params.id) });
    });
    router.delete('/:id', async (req, res) => {
        res.json({ message: `${Model.modelName} deleted.`, data: await remove(req.params.id) });
    });
    return router;
};
