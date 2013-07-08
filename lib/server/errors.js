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


function ProvisionFailedError(message) {
	restify.RestError.call(this, {
		restCode: 'ProvisionFailedError',
		statusCode: 500,
		message: message,
		constructorOpt: ProvisionFailedError
	});
	this.name = 'ProvisionFailedError';
}

util.inherits(ProvisionFailedError, restify.RestError);

module.exports.ProvisionFailedError = ProvisionFailedError;


function DestroyFailedError(message) {
	restify.RestError.call(this, {
		restCode: 'DestroyFailedError',
		statusCode: 500,
		message: message,
		constructorOpt: DestroyFailedError
	});
	this.name = 'DestroyFailedError';
}

util.inherits(DestroyFailedError, restify.RestError);

module.exports.DestroyFailedError = DestroyFailedError;

function ReprovisionFailedError(message) {
	restify.RestError.call(this, {
		restCode: 'ReprovisionFailedError',
		statusCode: 500,
		message: message,
		constructorOpt: ReprovisionFailedError
	});
	this.name = 'ReprovisionFailedError';
}

util.inherits(ReprovisionFailedError, restify.RestError);

module.exports.ReprovisionFailedError = ReprovisionFailedError;
