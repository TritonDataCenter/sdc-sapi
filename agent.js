/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * main.js: configuration agent
 *
 * This agent queries the metadata API for changes to a zone's configuration and
 * downloads and applies any applicable updates.
 */

var assert = require('assert-plus');
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

var log = new Logger({
	name: 'config-agent',
	level: config.logLevel,
	stream: process.stdout,
	serializers: restify.bunyan.serializers
});

config.log = log;

util.zonename(function (err, zonename) {
	if (err) {
		log.error(err, 'failed to determine zone name');
		process.exit(1);
	}

	config.zonename = zonename;

	var agent = new Agent(config);

	if (ARGV.s) {
		/*
		 * Synchronous mode is used as part of a zone's first boot and
		 * initial setup.  Instead of polling at some interval,
		 * immediately write out the configuration files and exit.
		 */
		agent.checkAndRefresh(function (suberr) {
			if (suberr)
				log.error(suberr, 'failed to write config');
			else
				log.info('wrote configuration synchronously');

			process.exit(suberr ? 1 : 0);
		});
	} else {
		setInterval(agent.checkAndRefresh.bind(agent),
		    config.pollInterval);
	}
});
