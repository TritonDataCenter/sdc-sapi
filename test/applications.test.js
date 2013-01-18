/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/applications.test.js: test /applications endpoints
 */

var async = require('async');
var common = require('./common');
var uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;


var URI = '/applications';
var APP_UUID;


// -- Tests

helper.before(function (cb) {
	this.client = helper.createJsonClient();
	this.sapi = helper.createSapiClient();

	cb(null);
});

helper.after(function (cb) {
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
		owner_uuid: common.ADMIN_UUID
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

test('create w/ invalid config', function (t) {
	var app = {
		name: 'invalid owner_uuid',
		owner_uuid: common.ADMIN_UUID,
		configs: [ uuid.v4() ]
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
		owner_uuid: common.ADMIN_UUID
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'no uuid here');
		t.equal(obj.owner_uuid, common.ADMIN_UUID);
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
		t.equal(obj.owner_uuid, common.ADMIN_UUID);
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
		owner_uuid: common.ADMIN_UUID,
		params: params
	};

	var cfg_uuid;

	var checkApp = function (obj) {
		t.equal(obj.name, app.name);
		t.equal(obj.uuid, app.uuid);
		t.equal(obj.owner_uuid, app.owner_uuid);
		t.deepEqual(obj.params, app.params);
		t.deepEqual(obj.configs, [ cfg_uuid ]);
	};

	var uri_app = '/applications/' + APP_UUID;

	async.waterfall([
		function (cb) {
			common.createConfig.call(self, function (err, cfg) {
				if (cfg) {
					cfg_uuid = cfg.uuid;
					app.configs = [ cfg_uuid ];
				}

				cb(err);
			});
		},
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
		},
		function (cb) {
			self.sapi.deleteConfig(cfg_uuid, cb);
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
		owner_uuid: common.ADMIN_UUID
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'This application name has spaces.');
		t.equal(obj.owner_uuid, common.ADMIN_UUID);
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
		t.equal(obj.owner_uuid, common.ADMIN_UUID);
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
