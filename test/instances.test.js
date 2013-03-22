/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/instances.test.js: test /instances endpoints
 */

var async = require('async');
var common = require('./common');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');
var sdc = require('sdc-clients');

var VMAPIPlus = require('../lib/server/vmapiplus');

var sprintf = require('util').format;

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;

var URI = '/instances';


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


// -- Test missing/invalid inputs

test('create w/ invalid inputs', function (t) {
	var self = this;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
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
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;
	inst.metadata = {
		string_val: 'my string',
		num_val: 123,
		bool_val: true,
		array_val: [ 1, 2, 3 ],
		obj_val: { foo: 'baz' }
	};

	var cfg_uuid;

	var check = function (obj) {
		t.equal(obj.uuid, inst.uuid);
		t.equal(obj.service_uuid, inst.service_uuid);
		t.deepEqual(obj.metadata, inst.metadata);
		t.deepEqual(obj.manifests, { my_service: cfg_uuid });
	};

	var checkInstanceInArray = function (obj) {
		t.ok(obj.length > 0);

		var found = false;

		for (var ii = 0; ii < obj.length; ii++) {
			if (obj[ii].uuid === inst.uuid) {
				check(obj[ii]);
				found = true;
			}
		}

		t.ok(found, 'found service' + inst.uuid);
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
			common.createManifest.call(self, function (err, cfg) {
				if (cfg) {
					cfg_uuid = cfg.uuid;
					inst.manifests =
					    { my_service: cfg_uuid };
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
			badinst.manifests = { my_service: node_uuid.v4() };

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
			var uri = '/instances?service_uuid=' +
			    inst.service_uuid;

			client.get(uri, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkInstanceInArray(obj);

				cb(null);
			});
		},
		function (cb) {
			client.get(URI, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				checkInstanceInArray(obj);

				cb(null);
			});
		},
		function (cb) {
			var uri = sprintf('/instances/%s/payload', inst.uuid);

			client.get(uri, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(obj);

				cb(null);
			});
		},
		function (cb) {
			common.testUpdates.call(self, t, uri_inst, cb);
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
			self.sapi.deleteManifest(cfg_uuid, function (err) {
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


function createVm(uuid, cb) {
	var params = {};
	params.brand = 'joyent-minimal';
	params.image_uuid = common.SMARTOS_163_UUID;
	params.owner_uuid = common.ADMIN_UUID;
	params.ram = 256;

	var vmapiplus = helper.createVmapiPlusClient();
	var cnapi = helper.createCnapiClient();
	var napi = helper.createNapiClient();

	async.waterfall([
		function (subcb) {
			cnapi.listServers(function (err, servers) {
				if (err)
					return (subcb(err));
				params.server_uuid = servers[0].uuid;
				subcb();
			});
		},
		function (subcb) {
			napi.listNetworks({ name: 'admin' },
			    function (err, networks) {
				if (err)
					return (subcb(err));
				params.networks = [ networks[0].uuid ];
				subcb();
			});
		},
		function (subcb) {
			vmapiplus.createVm(params, function (err) {
				subcb(err);
			});
		}
	], cb);
}


// -- Test creating an instance with VM already existing

test('create instance with VM aleady existing', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;

	var check = function (obj) {
		t.equal(obj.uuid, inst.uuid);
		t.equal(obj.service_uuid, inst.service_uuid);
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
			/*
			 * This check doesn't apply to proto mode.
			 */
			if (process.env.MODE === 'proto')
				return (cb(null));

			createVm(inst.uuid, cb);
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
			self.client.del(uri_inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 204);
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
	], function (err, results) {
		t.ifError(err);
		t.end();
	});
});



// -- Test deleting an instance with no corresponding zone

test('delete instance with no VM', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;

	var check = function (obj) {
		t.equal(obj.uuid, inst.uuid);
		t.equal(obj.service_uuid, inst.service_uuid);
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
			/*
			 * This check doesn't apply to proto mode.
			 */
			if (process.env.MODE === 'proto') {
				return (cb(null));
			}

			var url = process.env.VMAPI_URL || 'http://10.2.206.23';

			var vmapi = new sdc.VMAPI({
				url: url,
				agent: false
			});

			var vmapiplus = new VMAPIPlus({
				log: self.client.log,
				vmapi: vmapi
			});

			/*
			 * Here, delete the VM without deleting the
			 * corresponding SAPI instance.  Deleting the SAPI
			 * instance in the next callback should still succeed.
			 */
			vmapiplus.deleteVm(inst.uuid, function (err) {
				t.ifError(err);
				cb();
			});
		},
		function (cb) {
			self.client.del(uri_inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 204);
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
	], function (err, results) {
		t.ifError(err);
		t.end();
	});
});


// -- Test invalid zone parameters

test('invalid zone parameters', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;
	inst.params = {};

	/*
	 * This setting for the instance's RAM will pass initial VMAPI
	 * validation but ultimately cause VMAPI.createVm() to fail.
	 */
	inst.params.ram = 10 * 1024 * 1024 * 1024 * 1024;  // 10 TB

	var uri_inst = '/instances/' + inst.uuid;

	async.waterfall([
		function (cb) {
			common.createApplication.call(self, app_uuid, cb);
		},
		function (cb) {
			common.createService.call(self, app_uuid, svc_uuid, cb);
		},
		function (cb) {
			client.post(URI, inst, function (err, _, res, obj) {
				if (process.env.MODE === 'proto')
					t.equal(res.statusCode, 200);
				else
					t.equal(res.statusCode, 500);
				cb();
			});
		},
		function (cb) {
			client.get(uri_inst, function (err, _, res, obj) {
				if (process.env.MODE === 'proto')
					t.equal(res.statusCode, 200);
				else
					t.equal(res.statusCode, 404);
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
	], function (err, results) {
		t.ifError(err);
		t.end();
	});
});
