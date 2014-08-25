#!/opt/smartdc/config-agent/build/node/bin/node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * mdata-update.js: update a zone's metadata
 */

var async = require('async');
var cp = require('child_process');
var fs = require('fs');
var optimist = require('optimist');
var sdc = require('sdc-clients');

var Logger = require('bunyan');

optimist.usage('Usage: mdata-update <key> <value>');
var ARGV = optimist.options({}).argv;

if (ARGV._.length !== 2) {
	optimist.showHelp();
	process.exit(1);
}

var LOG = new Logger({
	name: __filename,
	serializers: Logger.stdSerializers
});

var CFG = '/opt/smartdc/config-agent/etc/config.json';
var config = JSON.parse(fs.readFileSync(CFG, 'utf8'));

var SAPI = new sdc.SAPI({
	url: config.sapi.url,
	log: LOG,
	agent: false
});

var ZONENAME;

async.waterfall([
	function (cb) {
		cp.exec('/usr/bin/zonename', function (err, stdout) {
			if (err)
				throw (err);
			ZONENAME = stdout.trim();
			cb();
		});
	},
	function (cb) {
		var opts = {};
		opts.metadata = {};
		opts.metadata[ARGV._[0]] = ARGV._[1];

		opts.action = 'update';

		SAPI.updateInstance(ZONENAME, opts, function (err) {
			if (err)
				throw (err);
			cb();
		});
	}
], function () {
	console.log('Updated metadata key "' + ARGV._[0] + '"');
	process.exit(0);
});
