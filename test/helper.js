/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/helper.js: setup test environment
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var fs = require('fs');
var once = require('once');
var path = require('path');
var sdc = require('sdc-clients');
var restify = require('restify');

var SAPI = require('../lib/server/sapi');
var VMAPIPlus = require('../lib/server/vmapiplus');


// -- Helpers

function createLogger(name, stream) {
	var log = bunyan.createLogger({
		level: (process.env.LOG_LEVEL || 'warn'),
		name: name || process.argv[1],
		stream: stream || process.stdout,
		src: true,
		serializers: restify.bunyan.serializers
	});
	return (log);
}

function createJsonClient() {
	var log = createLogger();
	var client = restify.createJsonClient({
		agent: false,
		connectTimeout: 250,
		log: log,
		retry: false,
		type: 'http',
		url: process.env.SAPI_URL || 'http://localhost:80'
	});

	return (client);
}

function createSapiClient() {
	var log = createLogger();

	var client = new sdc.SAPI({
		agent: false,
		log: log,
		url: process.env.SAPI_URL || 'http://localhost:80'
	});

	return (client);
}

function createVmapiPlusClient() {
	var log = createLogger();

	var vmapi = new sdc.VMAPI({
		agent: false,
		log: log,
		url: process.env.VMAPI_URL || 'http://10.2.206.23'
	});

	var client = new VMAPIPlus({
		log: log,
		vmapi: vmapi
	});

	return (client);
}

function createNapiClient() {
	var log = createLogger();

	var client = new sdc.NAPI({
		agent: false,
		log: log,
		url: process.env.NAPI_URL || 'http://10.2.206.6'
	});

	return (client);
}

function createCnapiClient() {
	var log = createLogger();

	var client = new sdc.CNAPI({
		agent: false,
		log: log,
		url: process.env.CNAPI_URL || 'http://10.2.206.18'
	});

	return (client);
}

function startSapiServer(mode, cb) {
	if (arguments.length === 1) {
		cb = mode;
		mode = null;
	}

	assert.func(cb, 'cb');

	var file = path.join(__dirname, 'etc/config.kvm6.json');
	var config = JSON.parse(fs.readFileSync(file));

	config.vmapi.agent = false;
	config.napi.agent = false;
	config.imgapi.agent = false;
	config.remote_imgapi.agent = false;

	/*
	 * First, check the mode argument to this function.  If that's not
	 * specified, check the environment variables MODE.  Lastly, fallback on
	 * the mode from the configuration file.
	 */
	if (mode)
		config.mode = mode;
	else if (process.env.MODE)
		config.mode = process.env.MODE;

	config.log_options.streams = [
		{
			level: 'debug',
			path: path.join(__dirname, 'tests.log')
		}
	];

	var sapi = new SAPI(config);

	// Some of the tests use VMAPI and NAPI, so load those URLs into
	// environment variables.
	process.env.VMAPI_URL = config.vmapi.url;
	process.env.NAPI_URL = config.napi.url;
	process.env.CNAPI_URL = config.cnapi.url;

	sapi.start(function () {
		cb(null, sapi);
	});
}

function shutdownSapiServer(sapi, cb) {
	assert.object(sapi, 'sapi');
	assert.func(cb, 'cb');

	sapi.shutdown(cb);
}


// -- Exports

var num_tests = 0;

module.exports = {
	after: function after(teardown) {
		module.parent.exports.tearDown = function _teardown(callback) {
			try {
				teardown.call(this, callback);
			} catch (e) {
				console.error('after:\n' + e.stack);
				process.exit(1);
			}
		};
	},

	before: function before(setup) {
		module.parent.exports.setUp = function _setup(callback) {
			try {
				setup.call(this, callback);
			} catch (e) {
				console.error('before:\n' + e.stack);
				process.exit(1);
			}
		};
	},

	test: function test(name, tester) {
		num_tests++;

		module.parent.exports[name] = function _(t) {
			var _done = false;
			t.end = once(function end() {
				if (!_done) {
					_done = true;
					t.done();
				}
			});

			t.notOk = function notOk(ok, message) {
				return (t.ok(!ok, message));
			};

			tester.call(this, t);
		};
	},

	createLogger: createLogger,

	createJsonClient: createJsonClient,
	createSapiClient: createSapiClient,
	createVmapiPlusClient: createVmapiPlusClient,
	createNapiClient: createNapiClient,
	createCnapiClient: createCnapiClient,

	startSapiServer: startSapiServer,
	shutdownSapiServer: shutdownSapiServer,

	getNumTests: function () {
		return (num_tests);
	}
};
