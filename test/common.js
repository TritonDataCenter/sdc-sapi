/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/common.js: common routines for all tests
 */

var async = require('async');


var ADMIN_UUID = '00000000-0000-0000-0000-000000000000';
var SMARTOS_163_UUID = '01b2c898-945f-11e1-a523-af1afbe22822';

function createApplication(uuid, cb) {
	var name = 'empty_test_application';

	this.sapi.createApplication(name, ADMIN_UUID, { uuid: uuid },
	    function (err, app) {
		return (cb(err));
	});
}

function createService(app_uuid, uuid, cb) {
	var name = 'empty_test_service';

	var opts = {};
	opts.params = {};
	opts.params.ram = 256;
	opts.params.networks = [ 'admin' ];
	opts.params.image_uuid = SMARTOS_163_UUID;

	if (arguments.length === 2) {
		cb = uuid;
	} else {
		opts.uuid = uuid;
	}

	this.sapi.createService(name, app_uuid, opts, function (err, svc) {
		return (cb(err));
	});
}

function createManifest(cb) {
	var path = '/var/tmp/config.json';
	var template = '{ logLevel: "debug" }';
	var name = 'more_or_less_empty test config';

	this.sapi.createManifest(name, template, path, cb);
}

function testUpdates(t, uri, cb) {
	var self = this;

	async.waterfall([
		function (subcb) {
			var changes = {};
			changes.action = 'update';
			changes.params = {};
			changes.params.foo = 'baz';
			changes.metadata = {};
			changes.metadata.foo = 'bar';

			self.client.put(uri, changes,
			    function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.equal(obj.params.foo, 'baz');
				t.equal(obj.metadata.foo, 'bar');

				subcb(null);
			});
		},
		function (subcb) {
			var changes = {};
			changes.action = 'delete';
			changes.params = {};
			changes.params.foo = ' ';
			changes.metadata = {};
			changes.metadata.foo = ' ';

			self.client.put(uri, changes,
			    function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(!obj.params.foo);
				t.ok(!obj.metadata.foo);

				subcb(null);
			});
		},
		function (subcb) {
			var changes = {};
			changes.action = 'update';
			changes.params = {};
			changes.params.oldparam = 'oldvalue';
			changes.metadata = {};
			changes.metadata.oldmd = 'oldvalue';

			self.client.put(uri, changes,
			    function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.equal(obj.params.oldparam, 'oldvalue');
				t.equal(obj.metadata.oldmd, 'oldvalue');

				subcb(null);
			});
		},
		function (subcb) {
			var changes = {};
			changes.action = 'replace';
			changes.params = {};
			changes.params.newparam = 'newvalue';
			changes.metadata = {};
			changes.metadata.newmd = 'newvalue';

			self.client.put(uri, changes,
			    function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.equal(obj.params.newparam, 'newvalue');
				t.equal(obj.metadata.newmd, 'newvalue');
				t.equal(Object.keys(obj.params).length, 1);
				t.equal(Object.keys(obj.metadata).length, 1);

				subcb(null);
			});
		}
	], cb);
}


exports.ADMIN_UUID = ADMIN_UUID;
exports.SMARTOS_163_UUID = SMARTOS_163_UUID;

exports.createApplication = createApplication;
exports.createService = createService;
exports.createManifest = createManifest;

exports.testUpdates = testUpdates;
