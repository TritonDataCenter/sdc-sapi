/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * agent.js: SDC configuration agent
 *
 * This agent queries SAPI for changes to a zone's configuration, downloads
 * those changes, and applies any applicable updates.
 */

var assert = require('assert-plus');
var async = require('async');
var fs = require('fs');
var optimist = require('optimist');
var util = require('./lib/common/util');

var Agent = require('./lib/agent/agent');
var Logger = require('bunyan');
var restify = require('restify');


var ARGV = optimist.options({
	'f': {
		alias: 'file',
		describe: 'location of configuration file'
	},
	's': {
		alias: 'synchronous',
		describe: 'start agent in synchronous mode'
	}
}).argv;


var file = ARGV.f ? ARGV.f : '/opt/smartdc/config-agent/etc/config.json';
var contents = fs.readFileSync(file);
var config = JSON.parse(contents);

assert.object(config, 'config');
assert.string(config.logLevel, 'config.logLevel');
assert.number(config.pollInterval, 'config.pollInterval');
assert.object(config.sapi, 'config.sapi');
assert.string(config.sapi.url, 'config.sapi.url');

assert.optionalArrayOfString(config.localManifestDirs,
    'config.localManifestDirs');

var log = new Logger({
	name: 'config-agent',
	level: config.logLevel,
	stream: process.stdout,
	serializers: restify.bunyan.serializers
});

config.log = log;

var agent;

async.waterfall([
	function (cb) {
		util.zonename(function (err, zonename) {
			if (err)
				log.error(err, 'failed to determine zone name');

			config.zonename = zonename;
			return (cb(err));
		});
	},
	function (cb) {
		agent = new Agent(config);

		agent.init(function (err) {
			if (err)
				log.error(err, 'failed to initialize agent');
			return (cb(err));
		});
	},
	function (cb) {
		if (ARGV.s) {
			/*
			 * Synchronous mode is used as part of a zone's first
			 * boot and initial setup.  Instead of polling at some
			 * interval, immediately write out the configuration
			 * files and exit.
			 */
			agent.checkAndRefresh(function (err) {
				if (err) {
					log.error(err,
					    'failed to write config');
				} else {
					log.info('wrote ' +
					    'configuration synchronously');
				}

				cb(err);
			});
		} else {
			setInterval(agent.checkAndRefresh.bind(agent),
			    config.pollInterval);
			cb(null);
		}
	}
], function (err) {
	if (err)
		process.exit(1);

});
