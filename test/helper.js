/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/helper.js: setup test environment
 */

var assert = require('assert-plus');
var async = require('async');
var bunyan = require('bunyan');
var common = require('./common');
var fs = require('fs');
var once = require('once');
var path = require('path');
var sdc = require('sdc-clients');
var restify = require('restify');

var Logger = require('bunyan');
var SAPI = require('../lib/server/sapi');
var VMAPIPlus = require('../lib/server/vmapiplus');

var exec = require('child_process').exec;


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

function createVmapiClient() {
	var log = createLogger();

	var client = new sdc.VMAPI({
		agent: false,
		log: log,
		url: process.env.VMAPI_URL || 'http://10.2.206.23'
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

function createImgapiClient() {
	var log = createLogger();

	var client = new sdc.IMGAPI({
		agent: false,
		log: log,
		url: process.env.IMGAPI_URL || 'http://10.2.206.17'
	});

	return (client);
}


function startSapiServer(mode, cb) {
	if (arguments.length === 1) {
		cb = mode;
		mode = null;
	}

	assert.func(cb, 'cb');

	var file = path.join(__dirname, '../etc/config.json');
	var config = JSON.parse(fs.readFileSync(file));

	config.vmapi.agent = false;
	config.cnapi.agent = false;
	config.napi.agent = false;
	config.imgapi.agent = false;

	/*
	 * First, check the mode argument to this function.  If that's not
	 * specified, check the environment variable's MODE.  Lastly, fallback
	 * on the mode from the configuration file.
	 */
	if (mode === 'proto') {
		process.env.TEST_SAPI_PROTO_MODE = 'true';
	} else if (mode === 'full') {
		process.env.TEST_SAPI_PROTO_MODE = undefined;
	}

	var log_options = config.log_options;
	log_options.src = true;
	log_options.streams = [
		{
			level: 'debug',
			path: path.join(__dirname, 'tests.log')
		}
	];
	log_options.serializers = restify.bunyan.serializers;

	var log = new Logger(log_options);
	config.log = log;

	var sapi = new SAPI(config);

	// Some of the tests use other SDC services, so load those URLs into
	// environment variables.
	process.env.VMAPI_URL = config.vmapi.url;
	process.env.NAPI_URL = config.napi.url;
	process.env.IMGAPI_URL = config.imgapi.url;

	async.series([
		function getServerUuid(next) {
			var cmd = '/usr/sbin/mdata-get sdc:server_uuid';
			exec(cmd, function (err, stdout) {
				if (err)
					return (next(err));
				process.env.SERVER_UUID = stdout.trim();
				next();
			});
		},
		function getAdminUuid(next) {
			var cmd = '/usr/sbin/mdata-get sdc:owner_uuid';
			exec(cmd, function (err, stdout) {
				if (err)
					return (next(err));
				process.env.ADMIN_UUID = stdout.trim();
				next();
			});
		}
	], function done(err) {
		if (err)
			throw (err);
		sapi.start(function () {
			cb(null, sapi);
		});
	});
}

function shutdownSapiServer(sapi, cb) {
	assert.object(sapi, 'sapi');
	assert.func(cb, 'cb');

	sapi.shutdown(cb);
}

/*
 * Create a set of default VM params suitable for passing to
 * SAPI.createInstance() or VMAPI.createVm().
 *
 * If more specific params are required, callers should override those params.
 */
function consVmParams(cb) {
	var params = {};
	params.brand = 'joyent-minimal';
	params.image_uuid = common.IMAGE_UUID;
	params.owner_uuid = process.env.ADMIN_UUID;
	params.server_uuid = process.env.SERVER_UUID;
	params.ram = 256;

	async.waterfall([
		function (subcb) {
			var imgapi = createImgapiClient();

			imgapi.adminImportRemoteImageAndWait(
			    params.image_uuid, 'https://updates.joyent.com',
			    {
				skipOwnerCheck: true
			    },
			    function (err) {
				if (err && err.name ===
				    'ImageUuidAlreadyExistsError')
					err = null;
				subcb(err);
			});
		},
		function (subcb) {
			resolveNetwork('admin', function (err, uuid) {
				if (err)
					return (subcb(err));
				params.networks = [ { uuid: uuid } ];
				subcb();
			});
		}
	], function (err) {
		return (cb(err, params));
	});
}

/*
 * Resolve a network name to its NAPI UUID.
 */
function resolveNetwork(name, cb) {
	var napi = createNapiClient();
	napi.listNetworks({ name: name }, function (err, networks) {
		if (err)
			return (cb(err));
		return (cb(null, networks[0].uuid));
	});
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
	createVmapiClient: createVmapiClient,
	createVmapiPlusClient: createVmapiPlusClient,
	createNapiClient: createNapiClient,
	createImgapiClient: createImgapiClient,

	startSapiServer: startSapiServer,
	shutdownSapiServer: shutdownSapiServer,

	consVmParams: consVmParams,
	resolveNetwork: resolveNetwork,

	getNumTests: function () {
		return (num_tests);
	}
};
