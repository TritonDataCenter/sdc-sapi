/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * server.js: Main entry point for the Services API
 */

var assert = require('assert-plus');
var async = require('async');
var fs = require('fs');
var optimist = require('optimist');
var sdc = require('sdc-clients');

var common = require('./lib/server/common');

var Logger = require('bunyan');
var SAPI = require('./lib/server/sapi');

var sprintf = require('util').format;


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
config.log_options.serializers = Logger.stdSerializers;

var log = new Logger(config.log_options);
config.log = log;

var sapi = new SAPI(config);

sapi.start(function (err) {
	if (err) {
		console.error('failure to start sapi: ' + err.message);
		process.exit(1);
	}

	/*
	 * When the SAPI mode changes, update SAPI's configuration file to
	 * reflect that the mode has changed.  In addition, update any SDC
	 * metadata which refers to the SAPI mode.
	 */
	var onModeChange = function (cb) {
		log.info('mode change detected');
		updateConfigFile(cb);
	};

	sapi.registerModeChangeCallback(onModeChange, sapi);
});

function readConfig(cb) {
	fs.readFile(file, 'ascii', function (err, contents) {
		if (err) {
			log.error(err, 'failed to read file %s', file);
			return (cb(err));
		}

		var obj;
		try {
			obj = JSON.parse(contents);
		} catch (e) {
			var msg = sprintf('invalid JSON in %s', file);
			log.error(msg);
			return (cb(new Error(msg)));
		}

		return (cb(null, obj));
	});
}

function updateConfigFile(cb) {
	readConfig(function (err, obj) {
		if (err)
			return (cb(err));

		obj.mode = common.FULL_MODE;

		fs.writeFile(file, JSON.stringify(obj), function (suberr) {
			if (suberr) {
				log.error(suberr,
				    'failed to write file %s', file);
				return (cb(suberr));
			}

			log.info('updated SAPI config file with mode change');
			return (cb(null));
		});
	});
}
