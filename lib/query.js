'use strict';

const { ApiError } = require('./errors');
const { isObject } = require('./validation');

function parse(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string') throw new ApiError(400, `${key} must be a single JSON value.`);
    try { return JSON.parse(query[key]); } catch { throw new ApiError(400, `${key} must contain valid JSON.`); }
}

function objectParameter(query, key) {
    const value = parse(query, key, {});
    if (!isObject(value)) throw new ApiError(400, `${key} must be a JSON object.`);
    return value;
}

function projection(query) {
    const select = objectParameter(query, 'select');
    const modes = new Set();
    for (const [field, mode] of Object.entries(select)) {
        if (mode !== 0 && mode !== 1) throw new ApiError(400, 'select values must be 0 or 1.');
        if (field !== '_id') modes.add(mode);
    }
    if (modes.size > 1) throw new ApiError(400, 'select cannot mix included and excluded fields.');
    return select;
}

function collectionQuery(query, defaultLimit) {
    const where = objectParameter(query, 'where');
    const sort = objectParameter(query, 'sort');
    if (Object.values(sort).some(value => value !== 1 && value !== -1)) {
        throw new ApiError(400, 'sort values must be 1 or -1.');
    }
    const select = projection(query);
    const skip = parse(query, 'skip', 0);
    const limit = parse(query, 'limit', defaultLimit);
    for (const [field, value] of [['skip', skip], ['limit', limit]]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, `${field} must be a nonnegative integer.`);
    }
    const count = parse(query, 'count', false);
    if (typeof count !== 'boolean') throw new ApiError(400, 'count must be a boolean.');
    return { where, sort, select, skip, limit, count };
}

function publicDocument(document) {
    if (document === null) return null;
    const result = document.toObject ? document.toObject() : { ...document };
    delete result.__v;
    return result;
}

async function executeRead(query) {
    // Mongoose throws plain Errors for some invalid schema operators. Cast them
    // separately so bad client filters do not become internal-server errors.
    try { query.cast(); } catch { throw new ApiError(400, 'The query contains invalid field values.'); }
    try { return await query; } catch (error) {
        const invalidQuery = error.name === 'MongoServerError' &&
            (['BadValue', 'FailedToParse', 'TypeMismatch', 'InvalidOptions', 'InvalidPipelineOperator']
                .includes(error.codeName) || error.codeName?.startsWith('Location'));
        if (error.name === 'CastError' || invalidQuery) {
            throw new ApiError(400, 'The query contains an invalid filter or projection.');
        }
        throw error;
    }
}

async function list(Model, query, defaultLimit) {
    const options = collectionQuery(query, defaultLimit);
    if (options.count) return executeRead(Model.countDocuments(options.where).maxTimeMS(10000));
    const documents = await executeRead(Model.find(options.where).sort(options.sort).select(options.select)
        .skip(options.skip).limit(options.limit).maxTimeMS(10000).lean());
    return documents.map(publicDocument);
}

module.exports = { projection, collectionQuery, publicDocument, executeRead, list };
