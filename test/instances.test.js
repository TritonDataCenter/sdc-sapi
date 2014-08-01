/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test/instances.test.js: test /instances endpoints
 */
//
var async = require('async');
var common = require('./common');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');
var sdc = require('sdc-clients');
var vasync = require('vasync');

var VMAPIPlus = require('../lib/server/vmapiplus');

var sprintf = require('util').format;

if (require.cache[__dirname + '/helper.js'])
	delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;

var URI = '/instances';

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
 * Also note there this comment and another image uuid in common.js.
 */
var OLD_IMAGE = 'daffafa6-081c-4732-8419-0a572f7fee10';
var NEW_IMAGE = 'ee88648a-9327-cfc5-d0e9-ffcd407cbdbc';



// -- Boilerplate

var server;
var tests_run = 0;

helper.before(function (cb) {
	this.client = helper.createJsonClient();
	this.sapi = helper.createSapiClient();
	this.imgapi = helper.createImgapiClient();

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
	], function (err) {
		t.ifError(err);
		t.end();
	});
});


// -- Test a standard put/get/del vm instance

test('put/get/del vm instance', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;
	inst.params = {};
	inst.params.alias = 'sapitest-normal-instance';
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
		if (obj.params)
			t.equal(obj.params.server_uuid, process.env.SERVER_UUID);
		else
			t.fail('obj.params is undefined');
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
					inst.manifests = { my_service: cfg_uuid };
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
			var uri = '/instances?service_uuid=' + inst.service_uuid;

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
			var uri = sprintf('/configs/%s', inst.uuid);

			client.get(uri, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(obj);
				if (obj.metadata) {
					t.equal(obj.metadata.ZONE_UUID, inst.uuid);
					t.equal(obj.metadata.SERVER_UUID, process.env.SERVER_UUID);
				} else {
					t.fail('obj.METADATA is null');
				}

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


// -- Test a standard put/get/del agent instance

test('put/get/del agent instance', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	/*
	 * params can be set but they won't have any effect because agent instances
	 * are not vms
	 */
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

	var createService = function (the_app_uuid, uuid, cb) {
		var name = 'empty_agent_service';

		var opts = { uuid: uuid, type: 'agent' };

		self.sapi.createService(name, the_app_uuid, opts, function (err, svc) {
			return (cb(err));
		});
	};

	var uri_inst = '/instances/' + inst.uuid;

	async.waterfall([
		function (cb) {
			common.createApplication.call(self, app_uuid, cb);
		},
		function (cb) {
			createService(app_uuid, svc_uuid, cb);
		},
		function (cb) {
			common.createManifest.call(self, function (err, cfg) {
				if (cfg) {
					cfg_uuid = cfg.uuid;
					inst.manifests = { my_service: cfg_uuid };
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
			var uri = '/instances?service_uuid=' + inst.service_uuid;

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
			var uri = sprintf('/configs/%s', inst.uuid);

			client.get(uri, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				t.ok(obj);
				if (obj.metadata) {
					t.equal(obj.metadata.ZONE_UUID, inst.uuid); // deprecated
					t.equal(obj.metadata.INSTANCE_UUID, inst.uuid);
					t.equal(obj.metadata.SERVER_UUID, process.env.SERVER_UUID);
				} else {
					t.fail('obj.METADATA is null');
				}

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
	var vmapiplus = helper.createVmapiPlusClient();

	helper.consVmParams(function (err, params) {
		params.uuid = uuid;

		vmapiplus.createVm(params, cb);
	});
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
	inst.params = {};
	inst.params.alias = 'sapitest-vmexists';

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
			if (process.env.TEST_SAPI_PROTO_MODE === 'true')
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
	inst.params = {};
	inst.params.alias = 'sapitest-missingvm';

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
			if (process.env.TEST_SAPI_PROTO_MODE === 'true') {
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
	inst.params.networks = [ { name: 'admin', ip: '192.168.1.1'} ];

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
				if (process.env.TEST_SAPI_PROTO_MODE === 'true')
					t.equal(res.statusCode, 200);
				else
					t.equal(res.statusCode, 500);
				cb();
			});
		},
		function (cb) {
			client.get(uri_inst, function (err, _, res, obj) {
				if (process.env.TEST_SAPI_PROTO_MODE === 'true')
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

// -- Test upgrading a zone

test('upgrading a zone', function (t) {
	var self = this;
	var client = this.client;

	var vmapi = helper.createVmapiClient();

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;
	inst.params = {};
	inst.params.alias = 'sapitest-upgradevm';

	async.waterfall([
		function (cb) {
			// Before the test starts, download both images.
			if (process.env.TEST_SAPI_PROTO_MODE === 'true')
				return (cb());

			var images = [ OLD_IMAGE, NEW_IMAGE ];

			vasync.forEachParallel({
				func: function (image, subcb) {
					var imgapi = self.imgapi;
					imgapi.adminImportRemoteImageAndWait(
						image,
						'https://updates.joyent.com',
						{skipOwnerCheck: true},
						subcb);
				},
				inputs: images
			}, function (err) {
				cb();
			});
		},
		function (cb) {
			var uri = sprintf('/instances/%s/upgrade', inst.uuid);

			var opts = {};
			opts.image_uuid = NEW_IMAGE;

			client.put(uri, opts, function (err, _, res, obj) {
				t.equal(res.statusCode, 404);
				cb();
			});
		},
		function (cb) {
			helper.consVmParams(function (err, params) {
				if (err)
					return (cb(err));

				params.networks = [ 'admin' ];
				params.image_uuid = OLD_IMAGE;
				params.ram = 256;

				inst.params = params;
				cb();
			});
		},
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
				if (obj && obj.params) {
					t.equal(obj.params.image_uuid, OLD_IMAGE);
				}

				cb();
			});
		},
		function (cb) {
			var uri = sprintf('/instances/%s/upgrade', inst.uuid);

			var opts = {};
			opts.image_uuid = NEW_IMAGE;

			client.put(uri, opts, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);

				/*
				 * This call shouldn't actually change
				 * params.image_uuid.
				 */
				if (obj && obj.params) {
					t.equal(obj.params.image_uuid, OLD_IMAGE);
				}

				cb();
			});
		},
		function (cb) {
			if (process.env.TEST_SAPI_PROTO_MODE === 'true')
				return (cb());

			vmapi.getVm({ uuid: inst.uuid }, function (err, vm) {
				t.ifError(err);
				if (vm)
					t.equal(vm.image_uuid, NEW_IMAGE);
				else
					t.fail('VM object is null');
				cb();
			});
		},
		function (cb) {
			self.sapi.deleteInstance(inst.uuid, function (err) {
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


// -- Test passing NAPI-ifed networks

test('create instance with NAPI networks', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;
	inst.params = {};
	inst.params.alias = 'sapitest-napi-networks';

	var uri_inst = '/instances/' + inst.uuid;

	async.waterfall([
		function (cb) {
			common.createApplication.call(self, app_uuid, cb);
		},
		function (cb) {
			common.createService.call(self, app_uuid, svc_uuid, cb);
		},
		function (cb) {
			helper.resolveNetwork('admin', function (err, uuid) {
				inst.params = {};
				inst.params.networks = [ { uuid: uuid } ];
				cb(err);
			});
		},
		function (cb) {
			client.post(URI, inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);
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


// -- Test teardown hooks

test('teardown hooks', function (t) {
	var self = this;
	var client = this.client;

	var app_uuid = node_uuid.v4();
	var svc_uuid = node_uuid.v4();

	var inst = {};
	inst.uuid = node_uuid.v4();
	inst.service_uuid = svc_uuid;
	inst.params = {};
	inst.params.alias = 'sapitest-teardown-' + node_uuid.v4().substr(0, 8);
	inst.params.image_uuid = OLD_IMAGE;
	inst.params['teardown-hook'] = '/bin/false';

	var uri_svc = '/services/' + svc_uuid;
	var uri_inst = '/instances/' + inst.uuid;

	/*
	 * In proto mode, the teardown-hook can't run (since CNAPI is
	 * unavailable), so don't run this test.
	 */
	if (process.env.TEST_SAPI_PROTO_MODE === 'true') {
		t.end();
		return;
	}

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
				cb(null);
			});
		},
		function (cb) {
			/*
			 * Both destroying and reprovisioning an instance should
			 * fail when the teardown-hook fails.
			 */
			self.client.del(uri_inst, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 500);
				cb(null);
			});
		},
		function (cb) {
			var uri = sprintf('/instances/%s/upgrade', inst.uuid);

			var opts = {};
			opts.image_uuid = NEW_IMAGE;

			client.put(uri, opts, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 500);
				cb(null);
			});
		},
		function (cb) {
			self.client.get(uri_inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);
				cb(null);
			});
		},
		function (cb) {
			var opts = {};
			opts.params = {};
			opts.params['teardown-hook'] = '/bin/true';

			client.put(uri_inst, opts, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);
				t.equal(obj.params['teardown-hook'], '/bin/true');
				cb(null);
			});
		},
		function (cb) {
			delete inst.params['teardown-hook'];

			client.post(URI, inst, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);
				cb(null);
			});
		},
		function (cb) {
			var opts = {};
			opts.params = {};
			opts.params['teardown-hook'] = '/bin/false';

			client.put(uri_svc, opts, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);
				t.equal(obj.params['teardown-hook'], '/bin/false');
				cb(null);
			});
		},
		function (cb) {
			/*
			 * Both destroying and reprovisioning an instance should
			 * fail when the teardown-hook fails.  Note that in this
			 * case, the instance is inheriting its teardown-hook
			 * from the service.
			 */
			self.client.del(uri_inst, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 500);
				cb(null);
			});
		},
		function (cb) {
			var uri = sprintf('/instances/%s/upgrade', inst.uuid);

			var opts = {};
			opts.image_uuid = NEW_IMAGE;

			client.put(uri, opts, function (err, _, res, obj) {
				t.ok(err);
				t.equal(res.statusCode, 500);
				cb(null);
			});
		},
		function (cb) {
			var opts = {};
			opts.params = {};
			opts.params['teardown-hook'] = '/bin/true';

			client.put(uri_svc, opts, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);
				t.equal(obj.params['teardown-hook'], '/bin/true');
				cb(null);
			});
		},
		function (cb) {
			var uri = sprintf('/instances/%s/upgrade', inst.uuid);

			var opts = {};
			opts.image_uuid = NEW_IMAGE;

			client.put(uri, opts, function (err, _, res, obj) {
				t.ifError(err);
				t.equal(res.statusCode, 200);
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
