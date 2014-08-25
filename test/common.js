/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * test/common.js: common routines for all tests
 */

var assert = require('assert-plus');
var async = require('async');
var node_uuid = require('node-uuid');

/*
 * These images are manta-storage zones.  Not sure why those were picked, but
 * that's that.  If these are ever deleted from imgapi on updates.joyent.com,
 * then find two later ones, replace and go.  I fould these by:
 *
 * [root@headnode (us-east-3) ~]# sdc-imgadm list | grep manta-storage | tail -2
 *
 * Perhaps the long term solution here is to have the tests create their own
 * images somewhere.  If we could rely on a some sort of tag to find them, we
 * can determine if they are already there or need to be created.
 *
 * Also note there is this same comment and other image uuids in
 * instances.test.js
 */
var IMAGE_UUID = 'daffafa6-081c-4732-8419-0a572f7fee10';

function createApplication(uuid, cb) {
	var name = 'empty_test_application';

	var opts = {};
	opts.uuid = uuid;
	opts.params = {};
	if (process.env['IMAGE_UUID'])
		opts.params.image_uuid = process.env['IMAGE_UUID'];

	this.sapi.createApplication(name, process.env.ADMIN_UUID, opts,
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
	opts.params.image_uuid = IMAGE_UUID;

	if (arguments.length === 2)
		cb = uuid;
	else
		opts.uuid = uuid;

	this.sapi.createService(name, app_uuid, opts, function (err, svc) {
		return (cb(err));
	});
}

function createInstance(svc_uuid, uuid, cb) {
	var opts = {};

	if (arguments.length === 2)
		cb = uuid;
	else
		opts.uuid = uuid;

	if (!opts.params)
		opts.params = {};
	if (!opts.params.alias)
		opts.params.alias = 'sapitest-' + node_uuid.v4().substr(0, 8);

	this.sapi.createInstance(svc_uuid, opts, cb);
}

function createManifest(uuid, cb) {
	var opts = {};

	if (arguments.length === 1)
		cb = uuid;
	else
		opts.uuid = uuid;

	opts.path = '/var/tmp/config.json';
	opts.template = '{ logLevel: "debug" }';
	opts.name = 'more_or_less_empty test config';

	this.sapi.createManifest(opts, cb);
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

			function onPut(err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.equal(obj.params.foo, 'baz');
				t.equal(obj.metadata.foo, 'bar');

				subcb(null);
			}

			self.client.put(uri, changes, onPut);
		},
		function (subcb) {
			var changes = {};
			changes.action = 'delete';
			changes.params = {};
			changes.params.foo = ' ';
			changes.metadata = {};
			changes.metadata.foo = ' ';

			function onPut(err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(!obj.params.foo);
				t.ok(!obj.metadata.foo);

				subcb(null);
			}

			self.client.put(uri, changes, onPut);
		},
		function (subcb) {
			var changes = {};
			changes.action = 'update';
			changes.params = {};
			changes.params.oldparam = 'oldvalue';
			changes.metadata = {};
			changes.metadata.oldmd = 'oldvalue';

			function onPut(err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.equal(obj.params.oldparam, 'oldvalue');
				t.equal(obj.metadata.oldmd, 'oldvalue');

				subcb(null);
			}

			self.client.put(uri, changes, onPut);
		},
		function (subcb) {
			var changes = {};
			changes.action = 'replace';
			changes.params = {};
			changes.params.newparam = 'newvalue';
			changes.metadata = {};
			changes.metadata.newmd = 'newvalue';

			function onPut(err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.equal(obj.params.newparam, 'newvalue');
				t.equal(obj.metadata.newmd, 'newvalue');
				t.equal(Object.keys(obj.params).length, 1);
				t.equal(Object.keys(obj.metadata).length, 1);

				subcb(null);
			}

			self.client.put(uri, changes, onPut);
		}
	], cb);
}


exports.IMAGE_UUID = IMAGE_UUID;

exports.createApplication = createApplication;
exports.createService = createService;
exports.createInstance = createInstance;
exports.createManifest = createManifest;

exports.testUpdates = testUpdates;
