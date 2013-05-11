/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/applications.test.js: test /applications endpoints
 */

var async = require('async');
var common = require('./common');
var node_uuid = require('node-uuid');

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;


var URI = '/applications';
var APP_UUID;


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

test('get nonexistent application', function (t) {
	var uri_app = '/applications/' + node_uuid.v4();

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
		owner_uuid: process.env.ADMIN_UUID
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
		owner_uuid: node_uuid.v4()
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		if (process.env.MODE === 'proto') {
			t.ifError(err);
			t.equal(res.statusCode, 200);
		} else {
			t.ok(err);
			t.equal(res.statusCode, 404);
		}
		t.end();
	});
});

test('create w/ invalid manifest', function (t) {
	var app = {
		name: 'invalid manifest',
		owner_uuid: process.env.ADMIN_UUID,
		manifests: { my_service: node_uuid.v4() }
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ok(err);
		t.equal(res.statusCode, 404);
		t.end();
	});
});

// -- Test put/get/del application without specifying UUID

test('create application w/o UUID', function (t) {
	var app = {
		name: 'no uuid here',
		owner_uuid: process.env.ADMIN_UUID
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'no uuid here');
		t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
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
		t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
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

	APP_UUID = node_uuid.v4();

	var params = {
		dns: '10.0.0.2',
		domain: 'foo.co.us',
		vmapi: {
			url: 'https://10.0.0.10'
		}
	};

	var app = {
		name: 'mycoolapp_' + node_uuid.v4().substr(0, 8),
		uuid: APP_UUID,
		owner_uuid: process.env.ADMIN_UUID,
		params: params
	};

	var cfg_uuid;

	var checkApp = function (obj) {
		t.equal(obj.name, app.name);
		t.equal(obj.uuid, app.uuid);
		t.equal(obj.owner_uuid, app.owner_uuid);
		t.deepEqual(obj.params, app.params);
		t.deepEqual(obj.manifests, { my_service: cfg_uuid });
	};

	var checkAppInArray = function (obj) {
		t.ok(obj.length > 0);

		var found = false;

		for (var ii = 0; ii < obj.length; ii++) {
			if (obj[ii].uuid === APP_UUID) {
				checkApp(obj[ii]);
				found = true;
			}
		}

		t.ok(found, 'found application ' + APP_UUID);
	};

	var uri_app = '/applications/' + APP_UUID;

	async.waterfall([
		function (cb) {
			common.createManifest.call(self, function (err, cfg) {
				if (cfg) {
					cfg_uuid = cfg.uuid;
					app.manifests =
					    { my_service: cfg_uuid };
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
			var uri = '/applications?name=' + app.name;

			self.client.get(uri, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkApp(obj[0]);

				cb(null);
			});
		},
		function (cb) {
			var uri = '/applications?owner_uuid=' + app.owner_uuid;

			self.client.get(uri, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkAppInArray(obj);

				cb(null);
			});
		},
		function (cb) {
			self.client.get(URI, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkAppInArray(obj);

				cb(null);
			});
		},
		function (cb) {
			common.testUpdates.call(self, t, uri_app, cb);
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
			self.sapi.deleteManifest(cfg_uuid, cb);
		}
	], function (err, results) {
		t.ifError(err);
		t.end();
	});
});


// -- Test put/get/del application with already-used UUID

test('reuse application UUID', function (t) {
	var app = {
		name: 'This application name has spaces.',
		uuid: APP_UUID,
		owner_uuid: process.env.ADMIN_UUID
	};

	this.client.post(URI, app, function (err, req, res, obj) {
		t.ifError(err);
		t.equal(res.statusCode, 200);
		t.equal(obj.name, 'This application name has spaces.');
		t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
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
		t.equal(obj.owner_uuid, process.env.ADMIN_UUID);
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
