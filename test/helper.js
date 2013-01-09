/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/helper.js: setup test environment
 */

var bunyan = require('bunyan');
var once = require('once');
var restify = require('restify');


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

function checkResponse(t, res, code) {
	t.ok(res, 'null response');
	if (!res)
		return;
	t.equal(res.statusCode, code, 'HTTP status code mismatch');
	t.ok(res.headers);
	t.ok(res.headers.date);
	t.equal(res.headers.server, 'Manta');
	t.ok(res.headers['x-request-id']);
	t.ok(res.headers['x-server-name']);

	if (code === 200 || code === 201 || code === 202) {
		t.ok(res.headers['content-type']);
		var ct = res.headers['content-type'];
		/* JSSTYLED */
		if (!/application\/x-json-stream.*/.test(ct)) {
			t.ok(res.headers['content-length'] !== undefined);
			if (res.headers['content-length'] > 0)
				t.ok(res.headers['content-md5']);
		}
	}
}


// -- Exports

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
			t.checkResponse = checkResponse.bind(this, t);

			tester.call(this, t);
		};
	},

	createJsonClient: createJsonClient,
	createLogger: createLogger
};
