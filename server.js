/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * server.js: Main entry point for the Services API
 */

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
var contents = fs.readFileSync(file);
var config = JSON.parse(contents);

var sapi = new SAPI(config);

sapi.start(function (err) {
	if (err) {
		console.error('failure to start sapi: ' + err.message);
		process.exit(1);
	}
});
