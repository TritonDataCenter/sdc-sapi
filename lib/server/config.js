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

	assert.string(uuid, 'uuid');

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

module.exports.resolveAll = function resolveAll(configs, cb) {
	var self = this;

	assert.object(configs, 'configs');

	var uuids = [];
	Object.keys(configs).forEach(function (key) {
		assert.string(configs[key], 'configs[key]');
		uuids.push(configs[key]);
	});

	vasync.forEachParallel({
		func: function (uuid, subcb) {
			resolve.call(self, uuid, subcb);
		},
		inputs: uuids
	}, function (err, results) {
		if (err)
			return (cb(err));

		var manifests = [];

		results.operations.forEach(function (op) {
			manifests.push(op.result);
		});

		assert.arrayOfObject(manifests);

		return (cb(null, manifests));
	});
};
