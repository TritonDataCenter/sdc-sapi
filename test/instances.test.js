/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/instances.test.js: test /instances endpoints
 */

var async = require('async');
var common = require('./common');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');

var sprintf = require('util').format;

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;

var URI = '/instances';


// -- Tests

helper.before(function (cb) {
	this.client = helper.createJsonClient();
	this.sapi = helper.createSapiClient();

	cb(null);
});

helper.after(function (cb) {
	cb(null);
});


// -- Test missing/invalid inputs

test('create w/ invalid inputs', function (t) {
	var self = this;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.name = 'bad_instance';
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;

	function check409(err, res) {
		t.ok(err);
		t.equal(err.name, 'MissingParameterError');
		t.equal(res.statusCode, 409);
	}

	async.waterfall([
		function (cb) {
			common.createApplication.call(self, app_uuid, cb);
		},
		function (cb) {
			common.createService.call(self, app_uuid, svc_uuid, cb);
		},
		function (cb) {
			// missing name
			var badinst  = jsprim.deepCopy(inst);
			delete badinst.name;

			self.client.post(URI, badinst, function (err, _, res) {
				check409(err, res);
				cb();
			});
		},
		function (cb) {
			// missing service_uuid
			var badinst  = jsprim.deepCopy(inst);
			delete badinst.service_uuid;

			self.client.post(URI, badinst, function (err, _, res) {
				check409(err, res);
				cb();
			});
		},
		function (cb) {
			// invalid service_uuid
			var badinst  = jsprim.deepCopy(inst);
			badinst.service_uuid = node_uuid.v4();

			self.client.post(URI, badinst, function (err, _, res) {
				t.ok(err);
				t.equal(res.statusCode, 500);
				cb();
			});
		},
		function (cb) {
			self.sapi.deleteService(svc_uuid, function (err) {
				cb(err);
			});
		},
		function (cb) {
			self.sapi.deleteApplication(app_uuid, function (err) {
				cb(err);
			});
		}
	], function (err) {
		t.ifError(err);
		t.end();
	});
});


// -- Test a standard put/get/del instance

test('put/get/del instance', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.name = 'mycoolinstance';
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;

	var cfg_uuid;

	var check = function (obj) {
		t.equal(obj.name, inst.name);
		t.equal(obj.uuid, inst.uuid);
		t.equal(obj.service_uuid, inst.service_uuid);
		t.deepEqual(obj.configs, [ cfg_uuid ]);
	};

	var uri_inst = '/instances/' + inst.uuid;

	async.waterfall([
		function (cb) {
			common.createApplication.call(self, app_uuid, cb);
		},
		function (cb) {
			common.createService.call(self, app_uuid, svc_uuid, cb);
		},
		function (cb) {
			common.createConfig.call(self, function (err, cfg) {
				if (cfg) {
					cfg_uuid = cfg.uuid;
					inst.configs = [ cfg_uuid ];
				}

				cb(err);
			});
		},
		function (cb) {
			client.get(uri_inst, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 404);

				cb(null);
			});
		},
		function (cb) {
			// test invalid config manifest
			var badinst = jsprim.deepCopy(inst);
			badinst.configs = [ node_uuid.v4() ];

			client.post(URI, badinst, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 500);

				cb(null);
			});
		},
		function (cb) {
			client.post(URI, inst, function (err, _, res, obj) {
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
			client.get(URI, function (err, _, res, obj) {
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
			self.sapi.deleteConfig(cfg_uuid, function (err) {
				cb(err);
			});
		},
		function (cb) {
			self.sapi.deleteService(svc_uuid, function (err) {
				cb(err);
			});
		},
		function (cb) {
			self.sapi.deleteApplication(app_uuid, function (err) {
				cb(err);
			});
		}
	], function (err, results) {
		t.ifError(err);
		t.end();
	});
});
