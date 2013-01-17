/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/applications.js: test /applications endpoints
 */

var async = require('async');
var uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');


// -- Globals

var after = helper.after;
var before = helper.before;
var test = helper.test;

var APP_UUID;
var ADMIN_UUID = '00000000-0000-0000-0000-000000000000';  // admin

var URI = '/applications';


// -- Tests

before(function (cb) {
	this.client = helper.createJsonClient();

	cb(null);
});

after(function (cb) {
	cb(null);
});


// -- Test invalid inputs

test('get nonexistent application', function (t) {
	var uri_app = '/applications/' + uuid.v4();

	this.client.get(uri_app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 404);
		t.end();
	});
});

test('create w/o owner_uuid', function (t) {
	var app = {
		name: 'owner_uuid missing'
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(err.name, 'MissingParameterError');
		t.equal(res.statusCode, 409);
		t.end();
	});
});

test('create w/o name', function (t) {
	var app = {
		owner_uuid: ADMIN_UUID
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(err.name, 'MissingParameterError');
		t.equal(res.statusCode, 409);
		t.end();
	});
});

test('create w/ invalid owner_uuid', function (t) {
	var app = {
		name: 'invalid owner_uuid',
		owner_uuid: uuid.v4()
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 500);
		t.end();
	});
});


// -- Test put/get/del application without specifying UUID

test('create application w/o UUID', function (t) {
	var app = {
		name: 'no uuid here',
		owner_uuid: ADMIN_UUID
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'no uuid here');
		t.equal(obj.owner_uuid, ADMIN_UUID);
		APP_UUID = obj.uuid;
		t.end();
	});
});

test('get application w/o UUID', function (t) {
	var uri_app = '/applications/' + APP_UUID;

	this.client.get(uri_app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'no uuid here');
		t.equal(obj.owner_uuid, ADMIN_UUID);
		t.equal(obj.uuid, APP_UUID);
		t.end();
	});
});

test('delete application', function (t) {
	var self = this;

	var uri_app = '/applications/' + APP_UUID;

	this.client.del(uri_app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 204);

		self.client.get(uri_app, function (suberr, _, subres) {
			t.ok(suberr);
			t.equal(suberr.statusCode, 404);
			t.end();
		});
	});
});


// -- Test put/get/del application with specifying UUID and parameters

test('put/get/del application', function (t) {
	var self = this;

	APP_UUID = uuid.v4();

	var params = {
		dns: '10.0.0.2',
		domain: 'foo.co.us',
		vmapi: {
			url: 'https://10.0.0.10'
		}
	};

	var app = {
		name: 'mycoolapp',
		uuid: APP_UUID,
		owner_uuid: ADMIN_UUID,
		params: params
	};

	var checkApp = function (obj) {
		t.equal(obj.name, app.name);
		t.equal(obj.uuid, app.uuid);
		t.equal(obj.owner_uuid, app.owner_uuid);
		t.deepEqual(obj.params, app.params);
	};

	var uri_app = '/applications/' + APP_UUID;

	async.waterfall([
		function (cb) {
			self.client.post(URI, app, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkApp(obj);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_app, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkApp(obj);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(URI, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(obj.length > 0);

				var found = false;

				for (var ii = 0; ii < obj.length; ii++) {
					if (obj[ii].uuid === APP_UUID) {
						checkApp(obj[ii]);
						found = true;
					}
				}

				t.ok(found, 'found application ' + APP_UUID);

				cb(null);
			});
		},
		function (cb) {
			self.client.del(uri_app, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 204);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_app, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);
				cb(null);
			});
		}
	], function (err, results) {
		t.end();
	});
});


// -- Test put/get/del application with already-used UUID

test('reuse application UUID', function (t) {
	var app = {
		name: 'This application name has spaces.',
		uuid: APP_UUID,
		owner_uuid: ADMIN_UUID
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'This application name has spaces.');
		t.equal(obj.owner_uuid, ADMIN_UUID);
		t.equal(obj.uuid, APP_UUID);
		t.end();
	});
});

test('get reused application', function (t) {
	var uri_app = '/applications/' + APP_UUID;

	this.client.get(uri_app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'This application name has spaces.');
		t.equal(obj.owner_uuid, ADMIN_UUID);
		t.equal(obj.uuid, APP_UUID);
		t.end();
	});
});

test('delete reused application', function (t) {
	var self = this;

	var uri_app = '/applications/' + APP_UUID;

	this.client.del(uri_app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 204);

		self.client.get(uri_app, function (suberr, _, subres) {
			t.ok(suberr);
			t.equal(suberr.statusCode, 404);
			t.end();
		});
	});
});
