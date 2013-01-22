/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * mdata.js: get from the Metadata API
 */

var assert = require('assert-plus');
var exec = require('child_process').exec;
var sprintf = require('util').format;
var vasync = require('vasync');

exports.get = function get(key, cb) {
	var log = this.log;

	assert.string(key, 'key');
	assert.func(cb, 'cb');

	if (log)
		log.debug({ key: key }, 'mdata-get');

	var cmd = sprintf('/usr/sbin/mdata-get "%s"', key);

	exec(cmd, function (err, stdout, stderr) {
		if (err && stderr.substr(0, 16) === 'No metadata for ') {
			if (log)
				log.debug('no metadata for key "%s"', key);

			return (cb(null, {}));
		} else if (err) {
			if (log) {
				log.error(err, 'failed to get ' +
				    'metadata for key "%s"', key);
			}

			return (cb(new Error(err.message)));
		} else {
			var value = stdout.trim();

			try {
				value = JSON.parse(value);
			} catch (e) {}

			if (log) {
				log.debug({
					key: key,
					value: value
				}, 'found metadata value');
			}

			return (cb(null, value));
		}
	});
};

exports.getAll = function getAll(keys, cb) {
	var self = this;

	assert.arrayOfString(keys, 'keys');
	assert.func(cb, 'cb');

	vasync.forEachParallel({
		func: function (key, subcb) {
			self.mdata.get.call(self, key, subcb);
		},
		inputs: keys
	}, function (err, results) {
		if (err)
			return (cb(err));

		var values = [];

		results.operations.forEach(function (op) {
			values.push(op.result);
		});

		return (cb(null, values));
	});
};
