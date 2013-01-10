/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/services.js: test /services endpoints
 */

var async = require('async');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');


// -- Globals

var after = helper.after;
var before = helper.before;
var test = helper.test;

var SMARTOS_163_UUID = '01b2c898-945f-11e1-a523-af1afbe22822';

var URI = '/services';


// -- Helper functions

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


// -- Tests

before(function (cb) {
	this.client = helper.createJsonClient();

	cb();
});

after(function (cb) {
	cb();
});


// -- Test invalid inputs

test('create w/ missing inputs', function (t) {
	var self = this;

	var svc = {};
	svc.name = 'application_uuid missing';
	svc.application_uuid = node_uuid.v4();
	svc.image_uuid = SMARTOS_163_UUID;

	function check409(err, res) {
		t.ok(err);
		t.equal(res.statusCode, 409);
	}

	async.waterfall([
		function (cb) {
			var badsvc = jsprim.deepCopy(svc);
			delete badsvc.name;

			self.client.post(URI, badsvc, function (err, _, res) {
				check409(err, res);
				cb();
			});
		},
		function (cb) {
			var badsvc = jsprim.deepCopy(svc);
			delete badsvc.application_uuid;

			self.client.post(URI, badsvc, function (err, _, res) {
				check409(err, res);
				cb();
			});
		},
		function (cb) {
			var badsvc = jsprim.deepCopy(svc);
			delete badsvc.image_uuid;

			self.client.post(URI, badsvc, function (err, _, res) {
				check409(err, res);
				cb();
			});
		}
	], function (err) {
		t.end();
	});
});

test('create w/ invalid application_uuid', function (t) {
	var svc = {};
	svc.name = 'invalid application_uuid';
	svc.application_uuid = node_uuid.v4();  // invalid
	svc.image_uuid = SMARTOS_163_UUID;

	this.client.post('/services', svc, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 500);
		t.end();
	});
});

test('create w/ invalid image_uuid', function (t) {
	var self = this;

	var app = {};
	app.name = 'mycoolapp';
	app.uuid = node_uuid.v4();

	var svc = {};
	svc.name = 'invalid image_uuid';
	svc.application_uuid = app.uuid;
	svc.image_uuid = node_uuid.v4();  // invalid

	async.waterfall([
		function (cb) {
			createApplication.call(self, app.name, app.uuid, cb);
		},
		function (cb) {
			self.client.post(URI, svc, function (err, _, res) {
				t.ok(err);
				t.equal(res.statusCode, 500);
				cb();
			});
		},
		function (cb) {
			delApplication.call(self, app.uuid, cb);
		}
	], function (err) {
		t.end();
	});
});

test('get nonexistent service', function (t) {
	var uri_svc = '/services/' + node_uuid.v4();

	this.client.get(uri_svc, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 404);
		t.end();
	});
});


// -- Test a standard put/get/del service

test('put/get/del service', function (t) {
	var self = this;

	var params = {
		dns: '10.0.0.2',
		domain: 'foo.co.us',
		vmapi: {
			url: 'https://10.0.0.10'
		}
	};

	var app = {};
	app.name = 'mycoolapp';
	app.uuid = node_uuid.v4();

	var svc = {};
	svc.name = 'mycoolservice';
	svc.uuid = node_uuid.v4();
	svc.application_uuid = app.uuid;
	svc.image_uuid = SMARTOS_163_UUID;
	svc.params = params;

	var checkService = function (obj) {
		t.equal(obj.name, svc.name);
		t.equal(obj.uuid, svc.uuid);
		t.equal(obj.application_uuid, svc.application_uuid);
		t.equal(obj.image_uuid, svc.image_uuid);
		t.deepEqual(obj.params, svc.params);
	};

	var uri_svc = '/services/' + svc.uuid;

	async.waterfall([
		function (cb) {
			createApplication.call(self, app.name, app.uuid, cb);
		},
		function (cb) {
			self.client.get(uri_svc, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);
				cb();
			});
		},
		function (cb) {
			self.client.post(URI, svc, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkService(obj);

				cb();
			});
		},
		function (cb) {
			self.client.get(uri_svc, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkService(obj);

				cb();
			});
		},
		function (cb) {
			self.client.get(URI, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(obj.length > 0);

				var found = false;

				for (var ii = 0; ii < obj.length; ii++) {
					if (obj[ii].uuid === svc.uuid) {
						checkService(obj[ii]);
						found = true;
					}
				}

				t.ok(found, 'found service' + svc.uuid);

				cb();
			});
		},
		function (cb) {
			self.client.del(uri_svc, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 204);
				cb();
			});
		},
		function (cb) {
			self.client.get(uri_svc, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);
				cb();
			});
		},
		function (cb) {
			delApplication.call(self, app.uuid, cb);
		}
	], function (err, results) {
		t.end();
	});
});
