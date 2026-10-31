'use strict';

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    let status = 500;
    let message = 'The request could not be completed. Please try again.';
    if (error instanceof ApiError) {
        status = error.status;
        message = error.message;
    } else if (error.code === 11000) {
        status = 400;
        message = 'That email is already in use.';
    } else if (['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)) {
        status = 400;
        message = 'The request contains invalid field values.';
    } else if (error.type === 'entity.parse.failed') {
        status = 400;
        message = 'The request body must contain valid JSON.';
    } else if (error instanceof URIError) {
        status = 400;
        message = 'The request URL contains invalid encoding.';
    } else if (error.type === 'entity.too.large') {
        status = 413;
        message = 'The request body is too large.';
    }
    if (status === 500) {
        // Driver messages can contain connection details; log classification only.
        console.error('Request failed', { method: req.method, error: error.name, code: error.code });
    }
    res.status(status).json({ message, data: null });
}

module.exports = { ApiError, errorHandler };
