/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * server.js: Main entry point for the Services API
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var fs = require('fs');
var optimist = require('optimist');

var SAPI = require('./lib/server/sapi');



optimist.usage('Usage:\t node server.js [ -f <config file> ]');
var ARGV = optimist.options({
	'f': {
		'alias': 'file',
		'describe': 'location of configuration file'
	}
}).argv;

var file = ARGV.f ? ARGV.f : './etc/config.json';
var config = JSON.parse(fs.readFileSync(file));


assert.object(config.log_options);
config.log_options.serializers = bunyan.stdSerializers;
var log = bunyan.createLogger(config.log_options);
config.log = log;


var sapi = new SAPI(config);

sapi.start(function (err) {
	if (err) {
		log.fatal(err, 'failure to start SAPI');
		process.exit(1);
	}
});
