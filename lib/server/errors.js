/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/errors.js: SAPI errors
 */

var restify = require('restify');
var util = require('util');


// XXX This should subclass RestError
module.exports.ObjectNotFoundError = ObjectNotFoundError;

function ObjectNotFoundError(message) {
	this.name = 'ObjectNotFoundError';
	this.message = message;
}

ObjectNotFoundError.prototype = new Error();
ObjectNotFoundError.prototype.constructor = ObjectNotFoundError;


function UnsupportedOperationError(message) {
	restify.RestError.call(this, {
		restCode: 'UnsupportedOperationError',
		statusCode: 409,
		message: message,
		constructorOpt: UnsupportedOperationError
	});
	this.name = 'UnsupportedOperationError';
}

util.inherits(UnsupportedOperationError, restify.RestError);

module.exports.UnsupportedOperationError = UnsupportedOperationError;
