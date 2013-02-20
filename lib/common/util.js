/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/common/util.js: utility functions
 */

var assert = require('assert-plus');

var exec = require('child_process').exec;


// -- Exported interface

module.exports.zonename = zonename;

/*
 * Return the current zone name.
 */
function zonename(cb) {
	assert.func(cb, 'cb');

	exec('/usr/bin/zonename', function (err, stdout) {
		if (err)
			return (cb(new Error(err.message)));

		return (cb(null, stdout.trim()));
	});
}
