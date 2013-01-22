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

var Agent = require('./lib/agent/agent');
var Logger = require('bunyan');


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

var log = new Logger({
	name: 'config-agent',
	level: config.logLevel,
	stream: process.stdout
});

config.log = log;
config.mdata = require('./lib/agent/mdata');

var agent = new Agent(config);

if (ARGV.s) {
	// XXX Maybe I can just be done with the sentinel file?
	/*
	 * Synchronous mode is used as part of a zone's first boot and initial
	 * setup. Every time the configuration is written (or rewritten) in this
	 * zone, a sentinel file is touched.
	 *
	 * If the sentinel isn't present, then the configuration has never been
	 * written. If that's the case when started in synchronous mode, write
	 * the configuration and exit.
	 *
	 * If the sentinel is present, then just exit without writing the
	 * configuration.
	 */
	agent.alreadyWritten(function (err, written) {
		assert.ifError(err);

		if (written) {
			log.info('configuration already updated at least ' +
			    'once; exiting');
			process.exit(0);
		}

		agent.checkAndRefresh(function (suberr) {
			if (suberr) {
				log.error(suberr, 'failed to write ' +
				    'configuration');
			} else {
				log.info('wrote configuration synchronously');
			}
			process.exit(suberr ? 1 : 0);
		});
	});
} else {
	setInterval(refresh, config.pollInterval);
}

function refresh() {
	agent.checkAndRefresh.call(agent);
}
