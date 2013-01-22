/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/configs.js: manage configuration manifests
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var sprintf = require('util').format;


function resolve(uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid);

	self.getConfig(uuid, function (err, cfg) {
		if (err)
			return (cb(err));

		if (!cfg) {
			var msg = sprintf('config %s ' +
			    'doesn\'t exist', uuid);
			log.error(err, msg);
			return (cb(new Error(msg)));
		}

		return (cb(null, cfg));
	});
}

module.exports.resolveAll = function resolveAll(uuids, cb) {
	var self = this;

	assert.arrayOfString(uuids);

	vasync.forEachParallel({
		func: function (uuid, subcb) {
			resolve.call(self, uuid, subcb);
		},
		inputs: uuids
	}, function (err, results) {
		if (err)
			return (cb(err));

		var configs = [];

		results.operations.forEach(function (op) {
			configs.push(op.result);
		});

		assert.arrayOfObject(configs);

		return (cb(null, configs));
	});
};
