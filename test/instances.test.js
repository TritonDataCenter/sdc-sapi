/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/instances.js: test /instances endpoints
 */

var async = require('async');
var node_uuid = require('node-uuid');

var sprintf = require('util').format;

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');


// -- Globals

var after = helper.after;
var before = helper.before;
var test = helper.test;

var SMARTOS_163_UUID = '01b2c898-945f-11e1-a523-af1afbe22822';

function createApplication(name, uuid, cb) {
	var app = {};
	app.name = name;
	app.owner_uuid = '00000000-0000-0000-0000-000000000000';  // admin
	app.uuid = uuid;

	this.client.post('/applications', app, function (err) {
		cb(err);
	});
}

function delApplication(uuid, cb) {
	this.client.del('/applications/' + uuid, function (err) {
		cb(err);
	});
}

function createService(name, uuid, application_uuid, cb) {
	var svc = {};
	svc.name = name;
	svc.uuid = uuid;
	svc.image_uuid = SMARTOS_163_UUID;
	svc.application_uuid = application_uuid;
	svc.ram = 256;
	svc.networks = [ 'admin' ];

	this.client.post('/services', svc, function (err) {
		cb(err);
	});
}

function delService(uuid, cb) {
	this.client.del('/services/' + uuid, function (err) {
		cb(err);
	});
}


// -- Tests

before(function (cb) {
	this.client = helper.createJsonClient();

	cb(null);
});

after(function (cb) {
	cb(null);
});

// XXX Tests for invalid inputs


// -- Test a standard put/get/del instance

test('put/get/del instance', function (t) {
	var self = this;
	var client = this.client;

	var app = {};
	app.name = 'mycoolapp';
	app.uuid = node_uuid.v4();

	var svc = {};
	svc.name = 'mycoolservice';
	svc.uuid = node_uuid.v4();
	svc.application_uuid = app.uuid;

	var inst = {};
	inst.name = 'mycoolinstance';
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc.uuid;

	var check = function (obj) {
		t.equal(obj.name, inst.name);
		t.equal(obj.uuid, inst.uuid);
		t.equal(obj.service_uuid, inst.service_uuid);
	};

	var uri = '/instances';
	var uri_inst = '/instances/' + inst.uuid;

	async.waterfall([
		function (cb) {
			createApplication.call(self, app.name, app.uuid, cb);
		},
		function (cb) {
			createService.call(self, svc.name, svc.uuid,
			    svc.application_uuid, cb);
		},
		function (cb) {
			client.get(uri_inst, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);

				cb(null);
			});
		},
		function (cb) {
			client.post(uri, inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				check(obj);

				cb(null);
			});
		},
		function (cb) {
			client.get(uri_inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				check(obj);

				cb(null);
			});
		},
		function (cb) {
			client.get(uri, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(obj.length > 0);

				var found = false;

				for (var ii = 0; ii < obj.length; ii++) {
					if (obj[ii].uuid === inst.uuid) {
						check(obj[ii]);
						found = true;
					}
				}

				t.ok(found, 'found service' + inst.uuid);

				cb(null);
			});
		},
		function (cb) {
			self.client.del(uri_inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 204);
				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_inst, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);
				cb(null);
			});
		},
		function (cb) {
			delService.call(self, svc.uuid, cb);
		},
		function (cb) {
			delApplication.call(self, app.uuid, cb);
		}
	], function (err, results) {
		t.end();
	});
});
