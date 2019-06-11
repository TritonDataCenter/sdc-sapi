/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * test/instances.test.js: test /instances endpoints
 */

var async = require('async');
var jsprim = require('jsprim');
var node_uuid = require('node-uuid');
var sdcClients = require('sdc-clients');
var sprintf = require('util').format;
var vasync = require('vasync');

var common = require('./common');
var VMAPIPlus = require('../lib/server/vmapiplus');

if (require.cache[__dirname + '/helper.js'])
    delete require.cache[__dirname + '/helper.js'];
var helper = require('./helper.js');
var test = helper.test;



// ---- globals

var URI = '/instances';

/*
 * These images are manta-storage zones.  Not sure why those were picked, but
 * that's that.  If these are ever deleted from imgapi on updates.joyent.com,
 * then find two later ones, replace and go.  I found these by:
 *
 * [root@headnode (us-east-3) ~]# sdc-imgadm list | grep manta-storage | tail -2
 *
 * Perhaps the long term solution here is to have the tests create their own
 * images somewhere.  If we could rely on a some sort of tag to find them, we
 * can determine if they are already there or need to be created.
 */
var NEW_IMAGE = 'ee88648a-9327-cfc5-d0e9-ffcd407cbdbc';



// -- Setup a separate SAPI server instance

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

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            common.createService.call(self, app_uuid, svc_uuid, cb);
        },
        function (_, cb) {
            // missing service_uuid
            var badinst  = jsprim.deepCopy(inst);
            delete badinst.service_uuid;

            self.client.post(URI, badinst, function (err, req, res) {
                t.ok(err);
                t.equal(err.name, 'MissingParameterError');
                t.equal(res.statusCode, 409);
                cb();
            });
        },
        function (_, cb) {
            // invalid service_uuid
            var badinst  = jsprim.deepCopy(inst);
            badinst.service_uuid = node_uuid.v4();

            self.client.post(URI, badinst, function (err, req, res) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteService(svc_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err) {
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
    inst.params.billing_id = process.env.BILLING_ID;
    inst.params.alias = common.getUniqueTestResourceName('normal-instance');
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
        t.ok(obj.params);
        if (!obj.params) {
            t.fail('obj.params is undefined');
        } else {
            t.ok(Object.keys(obj.params).length);
        }
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

        t.ok(found, 'found instance ' + inst.uuid);
    };

    var uri_inst = '/instances/' + inst.uuid;

    t.ok(app_uuid, 'app uuid ' + app_uuid);
    t.ok(svc_uuid, 'svc uuid ' + svc_uuid);
    t.ok(inst.uuid, 'inst uuid ' + inst.uuid);

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            common.createService.call(self, app_uuid, svc_uuid, cb);
        },
        function (_, cb) {
            common.createManifest.call(self, function (err, cfg) {
                if (cfg) {
                    cfg_uuid = cfg.uuid;
                    inst.manifests = {
                        my_service: cfg_uuid
                    };
                }

                cb(err);
            });
        },
        function (_, cb) {
            client.get(uri_inst, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);

                cb(null);
            });
        },
        function (_, cb) {
            // test invalid config manifest
            var badinst = jsprim.deepCopy(inst);
            badinst.manifests = { my_service: node_uuid.v4() };

            client.post(URI, badinst, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 500);

                cb(null);
            });
        },
        function (_, cb) {
            client.post(URI, inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            client.get(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            var uri = '/instances?service_uuid=' +
                inst.service_uuid;

            client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkInstanceInArray(obj);

                cb(null);
            });
        },
        function (_, cb) {
            client.get(URI, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkInstanceInArray(obj);

                cb(null);
            });
        },
        function (_, cb) {
            var uri = sprintf('/instances/%s/payload', inst.uuid);

            client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                t.ok(obj);

                cb(null);
            });
        },
        function (_, cb) {
            var uri = sprintf('/configs/%s', inst.uuid);

            client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                t.ok(obj);
                if (!obj.metadata) {
                    t.fail('obj.METADATA is null');
                }

                cb(null);
            });
        },
        function (_, cb) {
            common.testUpdates.call(self, t, uri_inst, cb);
        },
        function (_, cb) {
            self.client.del(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                cb(null);
            });
        },
        function (_, cb) {
            self.client.get(uri_inst, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                cb(null);
            });
        },
        function (_, cb) {
            self.sapi.deleteManifest(cfg_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteService(svc_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err, results) {
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
     * params can be set but they won't have any effect because agent
     * instances are not vms
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

        t.ok(found, 'found service ' + inst.uuid);
    };

    var createService = function (the_app_uuid, uuid, cb) {
        var name = 'empty_agent_service';

        var opts = { uuid: uuid, type: 'agent' };

        self.sapi.createService(name, the_app_uuid, opts,
                    function (err, svc) {
                        return (cb(err));
                    });
    };

    var uri_inst = '/instances/' + inst.uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            createService(app_uuid, svc_uuid, cb);
        },
        function (_, cb) {
            common.createManifest.call(self, function (err, cfg) {
                if (cfg) {
                    cfg_uuid = cfg.uuid;
                    inst.manifests = {
                        my_service: cfg_uuid
                    };
                }

                cb(err);
            });
        },
        function (_, cb) {
            client.get(uri_inst, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);

                cb(null);
            });
        },
        function (_, cb) {
            // test invalid config manifest
            var badinst = jsprim.deepCopy(inst);
            badinst.manifests = { my_service: node_uuid.v4() };

            client.post(URI, badinst, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 500);

                cb(null);
            });
        },
        function (_, cb) {
            client.post(URI, inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            client.get(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            var uri = '/instances?service_uuid=' +
                inst.service_uuid;

            client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkInstanceInArray(obj);

                cb(null);
            });
        },
        function (_, cb) {
            function onRes(err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                checkInstanceInArray(obj);

                cb(null);
            }
            client.get(URI + '?type=agent', onRes);
        },
        function (_, cb) {
            var uri = sprintf('/instances/%s/payload', inst.uuid);

            client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                t.ok(obj);

                cb(null);
            });
        },
        function (_, cb) {
            var uri = sprintf('/configs/%s', inst.uuid);

            client.get(uri, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                t.ok(obj);
                if (!obj.metadata) {
                    t.fail('obj.METADATA is null');
                }

                cb(null);
            });
        },
        function (_, cb) {
            common.testUpdates.call(self, t, uri_inst, cb);
        },
        function (_, cb) {
            self.client.del(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                cb(null);
            });
        },
        function (_, cb) {
            self.client.get(uri_inst, function (err, req, res, obj) {
                t.ok(err);
                t.equal(res.statusCode, 404);
                cb(null);
            });
        },
        function (_, cb) {
            self.sapi.deleteManifest(cfg_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteService(svc_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err, results) {
        t.ifError(err);
        t.end();
    });
});

function createVm(uuid, cb) {
    var vmapiplus = helper.createVmapiPlusClient();

    helper.consVmParams(function (err, params) {
        params.uuid = uuid;

        vmapiplus.createVm(params, {}, cb);
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
    inst.params.alias = common.getUniqueTestResourceName('vmexists');

    var check = function (obj) {
        t.equal(obj.uuid, inst.uuid);
        t.equal(obj.service_uuid, inst.service_uuid);
    };

    var uri_inst = '/instances/' + inst.uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            common.createService.call(self, app_uuid, svc_uuid, cb);
        },
        function (_, cb) {
            /*
             * This check doesn't apply to proto mode.
             */
            if (process.env.TEST_SAPI_PROTO_MODE === 'true')
                return (cb(null));

            createVm(inst.uuid, cb);
        },
        function (_, cb) {
            client.post(URI, inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            client.get(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            self.client.del(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteService(svc_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err, results) {
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
    inst.params.billing_id = process.env.BILLING_ID;
    inst.params.alias = common.getUniqueTestResourceName('missingvm');

    var check = function (obj) {
        t.equal(obj.uuid, inst.uuid);
        t.equal(obj.service_uuid, inst.service_uuid);
    };

    var uri_inst = '/instances/' + inst.uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            common.createService.call(self, app_uuid, svc_uuid, cb);
        },
        function (_, cb) {
            client.post(URI, inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            client.get(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                check(obj);

                cb(null);
            });
        },
        function (_, cb) {
            /*
             * This check doesn't apply to proto mode.
             */
            if (process.env.TEST_SAPI_PROTO_MODE === 'true') {
                return (cb(null));
            }

            var url = process.env.VMAPI_URL || 'http://10.2.206.23';

            var vmapi = new sdcClients.VMAPI({
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
        function (_, cb) {
            self.client.del(uri_inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 204);
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteService(svc_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err, results) {
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
     * To test VMAPI CreateVm failure in server allocation (aka DAPI) we
     * can use `internal_metadata.force_designation_failure = true`.
     */
    inst.params.internal_metadata = {force_designation_failure: true};
    inst.params.networks = [ { name: 'admin' } ];
    inst.params.alias = common.getUniqueTestResourceName('invalid-zone-params');

    var uri_inst = '/instances/' + inst.uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            common.createService.call(self, app_uuid, svc_uuid, cb);
        },
        function (_, cb) {
            client.post(URI, inst, function (err, req, res, obj) {
                if (process.env.TEST_SAPI_PROTO_MODE === 'true') {
                    t.equal(res.statusCode, 200);
                } else {
                    t.equal(res.statusCode, 409,
                        sprintf('expected 409 status code from SAPI ' +
                            'CreateInstance: got %s, instance uuid %s',
                            res.statusCode, inst.uuid));
                }
                cb();
            });
        },
        function (_, cb) {
            client.get(uri_inst, function (err, req, res, obj) {
                if (process.env.TEST_SAPI_PROTO_MODE === 'true') {
                    t.equal(res.statusCode, 200);
                } else {
                    t.equal(res.statusCode, 404);
                }
                cb();
            });
        },
        function (_, cb) {
            self.sapi.deleteService(svc_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err, results) {
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
    inst.params.alias = common.getUniqueTestResourceName('sapitest-upgradevm');

    t.ok(process.env.SAPI_TEST_IMAGE_UUID, 'process.env.SAPI_TEST_IMAGE_UUID');
    var oldImage = process.env.SAPI_TEST_IMAGE_UUID;

    vasync.pipeline({funcs: [
        function (_, cb) {
            // Before the test starts, download both images.
            if (process.env.TEST_SAPI_PROTO_MODE === 'true')
                return (cb());

            var images = [ oldImage, NEW_IMAGE ];

            vasync.forEachParallel({
                func: function importOneImage(image, subcb) {
                    self.imgapi.adminImportRemoteImageAndWait(
                        image,
                        'https://updates.joyent.com',
                        {skipOwnerCheck: true},
                        subcb);
                },
                inputs: images
            }, function (err) {
                // This sucks. An `err` here could be either "already have it"
                // or some real error in attempting to import it.
                cb();
            });
        },
        function (_, cb) {
            var uri = sprintf('/instances/%s/upgrade', inst.uuid);

            var opts = {};
            opts.image_uuid = NEW_IMAGE;

            client.put(uri, opts, function (err, req, res, obj) {
                t.equal(res.statusCode, 404);
                cb();
            });
        },
        function (_, cb) {
            helper.consVmParams(function (err, params) {
                if (err)
                    return (cb(err));

                params.networks = [ 'admin' ];
                params.image_uuid = oldImage;
                params.ram = 256;

                inst.params = params;
                cb();
            });
        },
        function (_, cb) {
            common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
        },
        function (_, cb) {
            common.createService.call(self, app_uuid, svc_uuid, cb);
        },
        function (_, cb) {
            client.post(URI, inst, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);
                if (obj && obj.params) {
                    t.equal(obj.params.image_uuid, oldImage);
                }
                cb();
            });
        },
        function (_, cb) {
            var uri = sprintf('/instances/%s/upgrade', inst.uuid);

            var opts = {};
            opts.image_uuid = NEW_IMAGE;

            client.put(uri, opts, function (err, req, res, obj) {
                t.ifError(err);
                t.equal(res.statusCode, 200);

                /*
                 * This call shouldn't actually change
                 * params.image_uuid.
                 */
                if (obj && obj.params) {
                    t.equal(obj.params.image_uuid, oldImage);
                }

                cb();
            });
        },
        function (_, cb) {
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
        function (_, cb) {
            self.sapi.deleteInstance(inst.uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteService(svc_uuid, function (err) {
                cb(err);
            });
        },
        function (_, cb) {
            self.sapi.deleteApplication(app_uuid, function (err) {
                cb(err);
            });
        }
    ]}, function (err, results) {
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

    var uri_inst = '/instances/' + inst.uuid;

    var runone = function (net, pcb) {
        vasync.pipeline({funcs: [
            function (_, cb) {
                common.createApplication({sapi: self.sapi, uuid: app_uuid}, cb);
            },
            function (_, cb) {
                common.createService.call(self, app_uuid, svc_uuid, cb);
            },
            function (_, cb) {
                inst.params = {};
                inst.params.billing_id = process.env.BILLING_ID;
                inst.params.alias =
                    common.getUniqueTestResourceName('napi-nets-' + inst.uuid);
                inst.params.networks = net;
                cb(null);
            },
            function (_, cb) {
                client.post(URI, inst, function (err, req, res, obj) {
                    t.ifError(err);
                    t.equal(res.statusCode, 200);
                    cb(err);
                });
            },
            function (_, cb) {
                self.client.del(uri_inst, function (err, req, res, obj) {
                    t.ifError(err);
                    t.equal(res.statusCode, 204);
                    cb(err);
                });
            },
            function (_, cb) {
                self.sapi.deleteService(svc_uuid, function (err) {
                    cb(err);
                });
            },
            function (_, cb) {
                self.sapi.deleteApplication(app_uuid, function (err) {
                    cb(err);
                });
            }
        ]}, function (err, results) {
            t.ifError(err);
            pcb(err);
        });
    };

    /*
     * Test that SAPI properly converts these 4 into valid VMAPI formats.
     *
     * [ { uuid: <uuid> }, ... ]
     * [ <uuid>, ... ]
     * [ { name: <name> }, ... ]
     * [ <name>, ... ]
     */
    var resolveAdmin = function (is_obj, callback) {
        helper.resolveNetwork('admin', process.env.ADMIN_UUID,
            function (err, uuid) {
                if (err) {
                    callback(err);
                    return;
                }
                if (is_obj) {
                    runone([ { uuid: uuid } ], callback);
                } else {
                    runone([ uuid ], callback);
                }
        });
    };

    vasync.pipeline({
        funcs: [
            function (_, callback) {
                resolveAdmin(true, callback);
            },
            function (_, callback) {
                resolveAdmin(false, callback);
            },
            function (_, callback) {
                runone([ { name: 'admin' } ], callback);
            },
            function (_, callback) {
                runone([ 'admin' ], callback);
            }
        ]
    }, function (err, results) {
        t.ifError(err);
        t.end();
    });
});
