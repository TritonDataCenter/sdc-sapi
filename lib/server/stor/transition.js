/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * lib/server/stor/transition.js: proxies requests through to old and new stores
 *                                during sapi mode transition.
 */

var assert = require('assert-plus');
var vasync = require('vasync');

module.exports = TransitionStorage;

function TransitionStorage(opts) {
	var self = this;

	assert.object(opts, 'opts');
	assert.object(opts.log, 'opts.log');
	assert.object(opts.old, 'opts.old');
	assert.object(opts.new, 'opts.new');

	self.log = opts.log;
	self.old = opts.old;
	self.new = opts.new;
}

TransitionStorage.prototype.init = function init(cb) {
	process.nextTick(cb);
};

// -- Object operations

TransitionStorage.prototype.putObject = putObject;

function putObject(bucket, uuid, obj, opts, cb) {
	var self = this;

	// Put to both places
	vasync.pipeline({
		'funcs': [
			function putOld(_, subcb) {
				self.old.putObject(bucket, uuid, obj,
						opts, subcb);
			},
			function putNew(_, subcb) {
				self.new.putObject(bucket, uuid, obj,
						opts, subcb);
			}
		]
	}, cb);
}

TransitionStorage.prototype.getObject = function getObject(bucket, uuid, cb) {
	var self = this;

	// Only read from the old.
	self.old.getObject(bucket, uuid, cb);
};

TransitionStorage.prototype.delObject = function delObject(bucket, uuid, cb) {
	var self = this;

	// Delete from both places
	vasync.pipeline({
		'funcs': [
			function delOld(_, subcb) {
				self.old.delObject(bucket, uuid, subcb);
			},
			function delNew(_, subcb) {
				self.new.delObject(bucket, uuid, subcb);
			}
		]
	}, cb);
};

TransitionStorage.prototype.listObjectValues = listObjectValues;

function listObjectValues(bucket, filters, opts, cb) {
	var self = this;

	// Only read from the old.
	self.old.listObjectValues(bucket, filters, opts, cb);
}

TransitionStorage.prototype.ping = function ping(cb) {
	var self = this;
	self.old.ping(function (err) {
		if (err) {
			return (cb(err));
		}
		self.new.ping(cb);
	});
};

TransitionStorage.prototype.close = function close() {
	// Nothing to do when closing client
	return;
};
