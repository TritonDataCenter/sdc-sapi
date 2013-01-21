/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/configs.js: manage configuration manifests
 */

var assert = require('assert-plus');
var vasync = require('vasync');

var sprintf = require('util').format;


module.exports.assemble = function assemble(app, svc, inst) {
	var self = this;
	var log = self.log;

	// XXX might make more sense to have an object of configs, not an array.
	// that way it could be indexed by name to allow inheritance.

	var configs = [];

	if (app.configs)
		configs = configs.concat(app.configs);
	if (svc.configs)
		configs = configs.concat(svc.configs);
	if (inst.configs)
		configs = configs.concat(inst.configs);

	log.info({ configs: configs }, 'assembled configs for zone');

	return (configs);
};

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
