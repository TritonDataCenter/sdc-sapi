/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/services.js: test /services endpoints
 */

var async = require('async');
var node_uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');


// -- Globals

var after = helper.after;
var before = helper.before;
var test = helper.test;

var OWNER_UUID = '3476660a-fec6-11e1-bd6b-d3f99fb834c1';

function createApplication(name, uuid, cb) {
	var app = {};
	app.name = name;
	app.owner_uuid = OWNER_UUID;
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

	cb(null);
});

after(function (cb) {
	cb(null);
});


// -- Test invalid inputs

test('get nonexistent service', function (t) {
	var uri = '/services/' + node_uuid.v4();

	this.client.get(uri, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 404);
		t.end();
	});
});

test('create w/o application_uuid', function (t) {
	var app = {
		name: 'application_uuid missing'
	};

	this.client.post('/services', app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 409);
		t.end();
	});
});

test('create w/o name', function (t) {
	var app = {
		application_uuid: node_uuid.v4()
	};

	this.client.post('/services', app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 409);
		t.end();
	});
});

test('create w/ invalid application_uuid', function (t) {
	var app = {
		name: 'invalid application_uuid',
		application_uuid: node_uuid.v4()
	};

	this.client.post('/services', app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 500);
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
	svc.params = params;

	var checkService = function (obj) {
		t.equal(obj.name, svc.name);
		t.equal(obj.uuid, svc.uuid);
		t.equal(obj.application_uuid, svc.application_uuid);
		t.deepEqual(obj.params, svc.params);
	};

	var uri = '/services';
	var uri_svc = '/services/' + svc.uuid;

	async.waterfall([
		function (cb) {
			createApplication.call(self, app.name, app.uuid, cb);
		},
		function (cb) {
			self.client.get(uri_svc, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);
				cb(null);
			});
		},
		function (cb) {
			self.client.post(uri, svc, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkService(obj);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_svc, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkService(obj);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri, function (err, _, res, obj) {
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

				cb(null);
			});
		},
		function (cb) {
			self.client.del(uri_svc, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 204);
				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_svc, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);
				cb(null);
			});
		},
		function (cb) {
			delApplication.call(self, app.uuid, cb);
		}
	], function (err, results) {
		t.end();
	});
});
