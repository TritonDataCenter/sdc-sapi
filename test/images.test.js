/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/images.test.js: test /images endpoints
 */

var async = require('async');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;


var URI = '/images';


// -- Boilerplate

var server;
var tests_run = 0;

helper.before(function (cb) {
	this.client = helper.createJsonClient();
	this.sapi = helper.createSapiClient();

	if (server)
		return (cb(null));

	helper.startSapiServer(function (err, res) {
		server = res;
		cb(err);
	});
});

helper.after(function (cb) {
	if (++tests_run === helper.getNumTests()) {
		helper.shutdownSapiServer(server, cb);
	} else {
		cb();
	}
});


// -- Test invalid inputs

test('missing "name" parameter', function (t) {
	this.client.get(URI, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 409);
		t.end();
	});
});


// -- Test download and install

test('find, download, install image', function (t) {
	var self = this;

	var uuid;

	async.waterfall([
		function (cb) {
			var uri = URI + '?name=moray';

			self.client.get(uri, function (err, _, res, obj) {
				if (process.env.MODE === 'proto') {
					t.ok(err);
					t.equal(err.name,
					    'UnsupportedOperationError');
					t.equal(res.statusCode, 409);
				} else {
					t.ifError(err);
					t.equal(res.statusCode, 200);
					t.ok(obj);
					uuid = obj[0].uuid;
				}

				cb(null);
			});
		},
		function (cb) {
			var uri = URI + '/' + uuid;

			self.client.post(uri, function (err, _, res, obj) {
				if (process.env.MODE === 'proto') {
					t.ok(err);
					t.equal(err.name,
					    'UnsupportedOperationError');
					t.equal(res.statusCode, 409);
				} else {
					t.ifError(err);
					t.equal(res.statusCode, 204);
				}
				cb(null);
			});
		},
		function (cb) {
			var uri = URI + '/' + uuid;

			// Downloading again has same result
			self.client.post(uri, function (err, _, res, obj) {
				if (process.env.MODE === 'proto') {
					t.ok(err);
					t.equal(err.name,
					    'UnsupportedOperationError');
					t.equal(res.statusCode, 409);
				} else {
					t.ifError(err);
					t.equal(res.statusCode, 204);
				}
				cb(null);
			});
		}
	], function (err, results) {
		t.ifError(err);
		t.end();
	});
});
