/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/model.js: SAPI's data model and associated operations on those
 *     objects.
 */

var async = require('async');
var assert = require('assert-plus');
var fs = require('fs');
var jsprim = require('jsprim');
var once = require('once');
var restify = require('restify');
var sdc = require('sdc-clients');
var node_uuid = require('node-uuid');
var vasync = require('vasync');

var Attributes = require('./attributes');
var VMAPIPlus = require('./vmapiplus');

var LocalStorage = require('./stor/local');
var MorayStorage = require('./stor/moray');
var MorayLocalStorage = require('./stor/moray_local');
var TransitionStorage = require('./stor/transition');

var mod_errors = require('./errors');

var exec = require('child_process').exec;
var sprintf = require('util').format;


// -- Moray bucket names

var BUCKETS = {
	applications: 'sapi_applications',
	services: 'sapi_services',
	instances: 'sapi_instances',
	manifests: 'sapi_manifests'
};



// -- Constructor and initialization routines

function Model(config) {
	this.config = config;
	this.log = config.log;

	assert.object(config, 'config');

	assert.object(config.log, 'config.log');

	assert.object(config.moray, 'config.moray');
	assert.string(config.moray.host, 'config.moray.host');

	assert.object(config.cnapi, 'config.cnapi');
	assert.string(config.cnapi.url, 'config.cnapi.url');

	assert.object(config.vmapi, 'config.vmapi');
	assert.string(config.vmapi.url, 'config.vmapi.url');

	assert.object(config.imgapi, 'config.imgapi');
	assert.string(config.imgapi.url, 'config.imgapi.url');

	assert.object(config.napi, 'config.napi');
	assert.string(config.napi.url, 'config.napi.url');

	config.moray.log = this.log;
	config.vmapi.log = this.log;
	config.cnapi.log = this.log;
	config.imgapi.log = this.log;
	config.napi.log = this.log;

	config.moray.noCache = true;
	config.moray.connectTimeout = 1000;
	config.moray.reconnect = true;
	config.moray.retry = {};
	config.moray.retry.retries = Infinity;
	config.moray.retry.minTimeout = 100;
	config.moray.retry.maxTimeout = 6000;
}

Model.prototype.initClients = function (cb) {
	var self = this;
	var config = self.config;
	var log = self.log;

	config.buckets = BUCKETS;

	self.attributes = new Attributes({
		model: self,
		log: log
	});

	async.series([
		function initMode(subcb) {
			// For testing allow to "TEST_SAPI_PROTO_MODE=true"
			// envvar.
			if (process.env.TEST_SAPI_PROTO_MODE === 'true') {
				self.proto_mode = true;
				self.proto_transition = false;
				subcb(null);
				return;
			}

			// If `SAPI_PROTO_MODE === 'true'`, then we are
			// in proto mode.
			var cmd = '/usr/sbin/mdata-get SAPI_PROTO_MODE';
			exec(cmd, function (err, stdout, stderr) {
				if (err && err.code === 1) {
					self.proto_mode = false;
				} else if (err) {
					log.error({
					    err: err,
					    stdout: stdout,
					    stderr: stderr
					}, 'error mdata-get\'ing ' +
					'SAPI_PROTO_MODE');
					subcb(err);
					return;
				} else {
					var val = stdout.trim();
					if (val !== 'true' && val !== 'false') {
					    log.warn({stdout: stdout},
						'unexpected value from "'
						+ 'mdata-get SAPI_PROTO_MODE"');
					}
					self.proto_mode = (val === 'true');
				}
				log.info({proto_mode: self.proto_mode},
				    'determined starting mode');
				subcb();
			});
		},
		function doFullClientInits(subcb) {
			if (self.proto_mode) {
				subcb(null);
				return;
			}

			initFullClients.call(self, config, subcb);
		},
		function initLocalStor(subcb) {
			self.local_stor = new LocalStorage(config);
			self.local_stor.init(subcb);
		},
		function initStor(subcb) {
			if (self.proto_mode) {
				self.stor = self.local_stor;
				return (subcb());
			}
			var m = 'Detected moray error on startup.  Most ' +
				'likely going to serve data from the local ' +
				'stor.  Continuing init...';
			self.moray_stor = new MorayStorage(config);
			self.moray_stor.init(function (err) {
				// We explicitly don't return moray errors
				// since we still want sapi up.
				self.stor = new MorayLocalStorage({
					'log': self.log,
					'buckets': BUCKETS,
					'moray': self.moray_stor,
					'local': self.local_stor
				});
				self.stor.init(function (err2) {
					if (err || err2) {
						log.error(m);
					}
					return (subcb());
				});
			});
		},
		function initServerUuid(subcb) {
			if (config.server_uuid) {
				self.server_uuid = config.server_uuid;
				subcb(null);
				return;
			}

			/*
			 * If not provided in the config, get the headnode's
			 * server_uuid from the metadata API.
			 */
			var cmd = '/usr/sbin/mdata-get sdc:server_uuid';
			exec(cmd, function (err, stdout, stderr) {
				if (err) {
					log.error(err,
					    'failed to get server_uuid');
					return (subcb(err));
				}

				self.server_uuid = stdout.trim();
				subcb();
			});
		}
	], function (err, _) {
		cb(err);
	});

};

function initFullClients(config, cb) {
	var self = this;

	self.vmapi = new sdc.VMAPI(config.vmapi);
	self.cnapi = new sdc.CNAPI(config.cnapi);
	self.imgapi = new sdc.IMGAPI(config.imgapi);
	self.napi = new sdc.NAPI(config.napi);

	self.vmapiplus = new VMAPIPlus({
		vmapi: self.vmapi,
		log: self.log
	});

	cb();
}

Model.prototype.close = function close(cb) {
	this.stor.close();
	cb();
};



// -- Helper functions

function getObjectValue(bucket, uuid, cb) {
	this.stor.getObject(bucket, uuid, function (err, record) {
		if (err)
			return (cb(err));

		var val = null;
		if (record)
			val = record.value;

		return (cb(null, val));
	});
}

Model.prototype.updateObject = updateObject;
function updateObject(bucket, uuid, change, action, tries, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');
	assert.object(change, 'change');
	assert.string(action, 'action');
	assert.ok(action === 'update' || action === 'replace' ||
	    action === 'delete');
	assert.func(cb, 'cb');

	log.debug({
		action: action,
		tries: tries
	}, 'updating object %s in bucket %s', uuid, bucket);

	async.waterfall([
		function (subcb) {
			self.stor.getObject(bucket, uuid, subcb);
		},
		function (record, subcb) {
			if (!record) {
				var m = sprintf(
					'updateObject failed: no record ' +
					' for bucket %s object %s',
					bucket, uuid);
				return (subcb(new Error(m)));
			}
			var obj = self.attributes.applyChange(
			    record.value, change, action);

			/*
			 * A one-off for applications: consumers can update the
			 * owner_uuid of a particular application through the
			 * UpdateApplication endpoint.
			 */
			if (bucket === BUCKETS.applications &&
			    change.owner_uuid) {
				obj.owner_uuid = change.owner_uuid;
			}

			var opts = {};
			if (record._etag)
				opts.etag = record._etag;

			self.stor.putObject(bucket, uuid, obj, opts,
			    function (err) {
				if (err && err.name === 'EtagConflictError' &&
				    tries > 0) {
					log.info('put of %s failed with ' +
					    'etag conflict; retrying', uuid);

					/*
					 * If the object has been modified,
					 * sleep 1 second and try the update
					 * again.
					 */
					setTimeout(updateObject.bind(self,
					    bucket, uuid, change, action,
					    tries - 1, cb), 1000);
					return (null);
				} else if (err) {
					log.error(err, 'failed to put object');
					return (subcb(err));
				}

				return (subcb(null));
			});
		},
		function (subcb) {
			assert.func(subcb, 'subcb');

			getObjectValue.call(self, bucket, uuid, subcb);
		}
	], function (err, obj) {
		if (err) {
			log.error(err, 'failed to update object');
			return (cb(err));
		}

		log.debug('updated object %s', uuid);

		return (cb(null, obj));
	});
}



// -- Applications

/*
 * Create an application.  An application consists of an name and owner_uuid.
 *
 * @param app
 * @param options {Object} Optional argument with flags
 * @param cb {Function}
 */
Model.prototype.createApplication = function createApplication(
    app, options, cb) {
	var self = this;
	var log = self.log;

	if (cb === undefined) {
		cb = options;
		options = {};
	}

	assert.object(app, 'app');
	assert.string(app.name, 'app.name');
	assert.string(app.owner_uuid, 'app.owner_uuid');

	assert.object(options, 'options');

	assert.optionalObject(app.params, 'app.params');
	assert.optionalObject(app.metadata, 'app.metadata');
	assert.optionalObject(app.manifests, 'app.manifests');
	assert.optionalBool(app.master, 'app.master');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!app.uuid)
		app.uuid = node_uuid.v4();

	log.info({
		name: app.name,
		owner_uuid: app.owner_uuid,
		options: options
	}, 'creating application %s', app.uuid);

	async.waterfall([
		function (subcb) {
			self.attributes.validate(app, options, subcb);
		},
		function (subcb) {
			self.stor.putObject(BUCKETS.applications,
			    app.uuid, app, function (err) {
				if (err) {
					log.error(err, 'failed to put ' +
					    'application %s', app.uuid);
					return (subcb(err));
				}

				return (subcb(null));
			});
		}
	], function (err, result) {
		if (!err)
			log.info('created application %s', app.uuid);
		cb(err, app);
	});
};

Model.prototype.listApplications = function (filters, opts, cb) {
	if (arguments.length === 2) {
		cb = opts;
		opts = {};
	}

	assert.object(filters, 'filters');
	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	this.stor.listObjectValues(
	    BUCKETS.applications, filters, opts, cb);
};

Model.prototype.getApplication = function (uuid, cb) {
	var log = this.log;

	cb = once(cb);

	getObjectValue.call(this, BUCKETS.applications, uuid,
	    function (err, app) {
		if (err) {
			log.error(err, 'failed to get application %s', uuid);
			return (cb(err));
		}

		if (!app) {
			err = new restify.ResourceNotFoundError(
			    'no such application: ' + uuid);
			log.error(err, 'failed to get application %s', uuid);
			return (cb(err));
		}

		return (cb(null, app));
	});
};

Model.prototype.updateApplication = function (uuid, change, action, cb) {
	this.updateObject(BUCKETS.applications, uuid, change, action, 3, cb);
};

Model.prototype.delApplication = function (uuid, cb) {
	this.stor.delObject(BUCKETS.applications, uuid, cb);
};



// -- Services

/*
 * Create a service.
 */
Model.prototype.createService = function createService(svc, cb) {
	var self = this;
	var log = self.log;

	assert.object(svc, 'svc');
	assert.string(svc.name, 'svc.name');
	assert.string(svc.application_uuid, 'svc.application_uuid');

	assert.optionalObject(svc.params, 'svc.params');
	assert.optionalObject(svc.metadata, 'svc.metadata');
	assert.optionalObject(svc.manifests, 'svc.manifests');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!svc.uuid)
		svc.uuid = node_uuid.v4();

	log.info({
		name: svc.name,
		application_uuid: svc.application_uuid
	}, 'creating service %s', svc.uuid);

	async.waterfall([
		function (subcb) {
			subcb = once(subcb);

			self.attributes.validate(svc, subcb);
		},
		function (subcb) {
			subcb = once(subcb);

			self.getApplication(svc.application_uuid,
			    function (err) {
				subcb(err);
			});
		},
		function (subcb) {
			self.stor.putObject(BUCKETS.services, svc.uuid, svc,
			    function (err) {
				if (err) {
					log.error(err, 'failed to put ' +
					    'service %s', svc.uuid);
					return (subcb(err));
				}

				return (subcb(null));
			});
		}
	], function (err, result) {
		if (!err)
			log.info('created service %s', svc.uuid);
		cb(err, svc);
	});
};

Model.prototype.listServices = function (filters, opts, cb) {
	if (arguments.length === 2) {
		cb = opts;
		opts = {};
	}

	assert.object(filters, 'filters');
	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	this.stor.listObjectValues(
	    BUCKETS.services, filters, opts, cb);
};

Model.prototype.getService = function (uuid, cb) {
	var log = this.log;

	getObjectValue.call(this, BUCKETS.services, uuid,
	    function (err, svc) {
		if (err) {
			log.error(err, 'failed to get service %s', uuid);
			return (cb(err));
		}

		if (!svc) {
			err = new restify.ResourceNotFoundError(
			    'no such service: ' + uuid);
			log.error(err, 'failed to get service %s', uuid);
			return (cb(err));
		}

		return (cb(null, svc));
	});
};

Model.prototype.updateService = function (uuid, change, action, cb) {
	this.updateObject(BUCKETS.services, uuid, change, action, 3, cb);
};

Model.prototype.delService = function (uuid, cb) {
	this.stor.delObject(BUCKETS.services, uuid, cb);
};



// -- Instances

/*
 * Create a instance.
 */
Model.prototype.createInstance = function createInstance(inst, cb) {
	var self = this;
	var log = self.log;

	assert.object(inst, 'inst');
	assert.string(inst.service_uuid, 'inst.service_uuid');
	assert.optionalString(inst.uuid, 'inst.uuid');
	assert.optionalObject(inst.params, 'inst.params');
	assert.optionalObject(inst.metadata, 'inst.metadata');
	assert.optionalObject(inst.manifests, 'inst.manifests');
	assert.func(cb, 'cb');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!inst.uuid)
		inst.uuid = node_uuid.v4();

	log.info({
		service_uuid: inst.service_uuid
	}, 'creating instance %s', inst.uuid);

	async.waterfall([
		function (subcb) {
			/*
			 * If no server_uuid is specified, use the current
			 * system.  Really, the SAPI client should have provided
			 * a server_uuid or a trait, but short of that, use the
			 * headnode's server_uuid so the provision will succeed.
			 */
			if (!inst.params)
				inst.params = {};
			if (!inst.params.server_uuid)
				inst.params.server_uuid = self.server_uuid;

			subcb();
		},
		function (subcb) {
			self.attributes.validate(inst, subcb);
		},
		function (subcb) {
			self.getService(inst.service_uuid, function (err) {
				subcb(err);
			});
		},
		function (subcb) {
			self.stor.putObject(BUCKETS.instances, inst.uuid, inst,
			    function (err) {
				if (err) {
					log.error(err, 'failed to put ' +
					    'instance %s', inst.uuid);
					return (subcb(err));
				}

				return (subcb(null));
			});
		},
		function (subcb) {
			deployInstance.call(self, inst, subcb);
		}
	], function (err) {
		if (err) {
			/*
			 * If any step of creating the instance fails, attempt
			 * to remove the instance object from moray.
			 */
			self.stor.delObject(BUCKETS.instances, inst.uuid,
			    function (suberr) {
				if (suberr) {
					log.warn(suberr, 'failed to delete ' +
					    'instance object %s after error',
					    inst.uuid);
				}

				// Return the original error
				cb(err);
			});

			return;
		}

		log.info('created instance %s', inst.uuid);
		cb(null, inst);
	});
};

Model.prototype.listInstances = function (filters, opts, cb) {
	if (arguments.length === 2) {
		cb = opts;
		opts = {};
	}

	assert.object(filters, 'filters');
	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	this.stor.listObjectValues(
	    BUCKETS.instances, filters, opts, cb);
};

Model.prototype.getInstance = function (uuid, cb) {
	var log = this.log;

	getObjectValue.call(this, BUCKETS.instances, uuid,
	    function (err, inst) {
		if (err) {
			log.error(err, 'failed to get instance %s', uuid);
			return (cb(err));
		}

		if (!inst) {
			err = new restify.ResourceNotFoundError(
			    'no such instance: ' + uuid);
			log.error(err, 'failed to get instance %s', uuid);
			return (cb(err));
		}

		return (cb(null, inst));
	});
};

Model.prototype.getInstancePayload = function (uuid, cb) {
	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	this.attributes.generateZoneParams(uuid, cb);
};

Model.prototype.updateInstance = function (uuid, change, action, cb) {
	this.updateObject(BUCKETS.instances, uuid, change, action, 3, cb);
};

Model.prototype.upgradeInstance = function (uuid, image_uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');
	assert.string(image_uuid, 'image_uuid');
	assert.func(cb, 'cb');

	var inst;

	async.waterfall([
		function (subcb) {
			self.getInstance(uuid, function (err, obj) {
				if (err)
					return (subcb(err));

				inst = obj;
				return (subcb(null));
			});
		},
		function (subcb) {
			/*
			 * Since all data not stored in the instance's delegated
			 * dataset will be deleted upon a reprovision, run the
			 * teardown-hook script here.
			 */
			runTeardownHook.call(self, inst, subcb);
		},
		function (subcb) {
			if (self.proto_mode) {
				log.info('in proto mode, not upgrading VM');
				return (subcb(null, inst));
			}

			self.vmapiplus.reprovisionVm(uuid, image_uuid,
			    function (err) {
				if (err) {
					log.error(err,
					    'failed to reprovision VM %s',
					    uuid);
					return (subcb(err));
				}

				return (subcb(null, inst));
			});
		}
	], cb);
};

Model.prototype.delInstance = function (uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			self.getInstance(uuid, subcb);
		},
		function (inst, subcb) {
			runTeardownHook.call(self, inst, subcb);
		},
		function (subcb) {
			if (self.proto_mode) {
				log.info('in proto mode, no VM to delete');
				return (subcb(null));
			}

			self.vmapiplus.deleteVm(uuid, function (err) {
				if (err) {
					log.error(err,
					    'failed to delete VM %s', uuid);
					return (subcb(err));
				}

				return (subcb(null));
			});
		},
		function (subcb) {
			self.stor.delObject(BUCKETS.instances, uuid,
			    function (err) {
				if (err) {
					log.warn(err, 'failed to ' +
					    'delete instance object %s', uuid);
					return (subcb(err));
				}

				return (subcb(null));
			});
		}
	], cb);
};

function runTeardownHook(inst, cb) {
	var self = this;
	var log = self.log;

	assert.object(inst, 'inst');
	assert.string(inst.uuid, 'inst.uuid');
	assert.func(cb, 'cb');

	if (self.proto_mode) {
		log.info('in proto mode, no need to run teardown-hook');
		return (cb(null));
	}

	var script;
	var server_uuid;

	async.waterfall([
		function (subcb) {
			self.attributes.generateZoneParams(inst.uuid, subcb);
		},
		function (params, subcb) {
			if (!params || !params['teardown-hook']) {
				log.info('no params[\'teardown-hook\'] ' +
				    ' for instance %s', inst.uuid);
				return (cb(null));
			}

			script = params['teardown-hook'];
			subcb();
		},
		function (subcb) {
			verifyZoneExists.call(self, inst.uuid,
			    function (err, vm) {
				if (err)
					return (cb(err));

				server_uuid = vm.server_uuid;
				subcb();
			});
		},
		function (subcb) {
			script = sprintf('/usr/sbin/zlogin %s "%s"',
			    inst.uuid, script);

			log.info({
				server_uuid: server_uuid,
				script: script
			}, 'running teardown-hook script');

			self.cnapi.commandExecute(server_uuid, script,
			    function (suberr) {
				if (suberr) {
					log.error(suberr, 'failed to execute ' +
					    'command on %s', server_uuid);

					suberr =
					    new mod_errors.TeardownHookError(
					    suberr.message);

					return (subcb(suberr));
				}

				log.info('executed command on %s', server_uuid);
				subcb();
			});
		}
	], function (err) {
		cb(err);
	});

	return (null);
}

function deployInstance(inst, cb) {
	var self = this;

	assert.object(inst, 'inst');
	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			self.attributes.generateZoneParams(inst.uuid, subcb);
		},
		function (params, subcb) {
			assert.object(params, 'params');
			assert.func(subcb, 'subcb');

			if (inst.exists)
				verifyZoneExists.call(self, inst.uuid, subcb);
			else
				provisionZone.call(self, params, subcb);
		}
	], function (err) {
		cb(err);
	});
}


/*
 * Checks VMAPI to see if a the given zone exists.  If in proto mode, assume it
 * exists.
 *
 * Returns an error if the zone does not exist.
 */
function verifyZoneExists(uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	if (self.proto_mode) {
		log.info('skipping verification of %s since in proto mode',
		    uuid);
		return (cb(null, true));
	}

	log.info('checking to ensure zone %s exists', uuid);

	self.vmapi.getVm({ uuid: uuid }, function (err, vm) {
		if (err && err.name === 'ResourceNotFoundError') {
			var msg = sprintf('no such zone: %s', uuid);
			log.warn(msg);
			return (cb(new restify.InvalidArgumentError(msg)));
		} else if (err) {
			log.error(err, 'failed to get VM %s', uuid);
			return (cb(err));
		}

		log.info('VM %s exists', uuid);
		return (cb(null, vm));
	});

	return (null);
}

function provisionZone(params, cb) {
	var self = this;
	var log = self.log;

	assert.object(params, 'params');
	assert.string(params.uuid, 'params.uuid');

	if (self.proto_mode) {
		log.info('skipping provision of %s since in proto mode',
		    params.uuid);
		return (cb(null));
	}

	log.info('checking to see if %s already exists', params.uuid);

	self.vmapi.getVm({ uuid: params.uuid }, function (err, vm) {
		if (err && err.name === 'ResourceNotFoundError') {
			log.debug({ params: params }, 'provisioning zone');
			self.vmapiplus.createVm(params, cb);
			return;
		} else if (err) {
			log.error(err, 'failed to get zone %s', params.uuid);
			return (cb(err));
		}

		log.info('zone %s already exists', params.uuid);
		return (cb(null));
	});

	return (null);
}



// -- Manifests

/*
 * Create a configuration manifest.
 */
Model.prototype.createManifest = function createManifest(mfest, cb) {
	var self = this;
	var log = self.log;

	assert.object(mfest, 'mfest');
	assert.string(mfest.name, 'mfest.name');
	assert.string(mfest.path, 'mfest.path');
	assert.ok(mfest.template, 'mfest.template');
	assert.optionalString(mfest.post_cmd, 'mfest.post_cmd');
	assert.optionalString(mfest.version, 'mfest.version');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!mfest.uuid)
		mfest.uuid = node_uuid.v4();

	/*
	 * If no version specified, use version 1.0.0.
	 */
	if (!mfest.version)
		mfest.version = '1.0.0';

	log.info({
		name: mfest.name,
		path: mfest.path,
		post_cmd: mfest.post_cmd,
		version: mfest.version
	}, 'creating manifest %s', mfest.uuid);

	self.stor.putObject(BUCKETS.manifests, mfest.uuid, mfest,
	    function (err) {
		if (err) {
			log.error(err, 'failed to put ' +
			    'configuration manifest %s', mfest.uuid);
			return (cb(err));
		}

		log.info('created manifest %s', mfest.uuid);

		return (cb(err, mfest));
	});
};

Model.prototype.listManifests = function (opts, cb) {
	if (arguments.length === 1) {
		cb = opts;
		opts = {};
	}

	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	this.stor.listObjectValues(BUCKETS.manifests, {}, opts, cb);
};

Model.prototype.getManifest = function (uuid, cb) {
	var log = this.log;

	getObjectValue.call(this, BUCKETS.manifests, uuid,
	    function (err, mfest) {
		if (err) {
			log.error(err, 'failed to get manifest %s', uuid);
			return (cb(err));
		}

		if (!mfest) {
			err = new restify.ResourceNotFoundError(
			    'no such manifest: ' + uuid);
			log.error(err, 'failed to get manifest %s', uuid);
			return (cb(err));
		}

		return (cb(null, mfest));
	});
};

Model.prototype.delManifest = function (uuid, cb) {
	this.stor.delObject(BUCKETS.manifests, uuid, cb);
};



// -- Configs

Model.prototype.getConfig = function getConfig(uuid, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');

	this.attributes.generateZoneConfig(uuid, function (err, config) {
		if (err)
			log.error('failed to generate config');

		return (cb(err, config));
	});
};



// -- Mode

Model.prototype.isProtoMode = function isProtoMode(cb) {
	assert.func(cb, 'cb');
	cb(null, this.proto_mode);
};

Model.prototype.upgradeToFullMode = function upgradeToFullMode(cb) {
	var self = this;
	var log = self.log;
	assert.func(cb, 'cb');

	if (!self.proto_mode) {
		log.info('already in full mode');
		return (cb(null));
	}
	if (self.proto_transition) {
		log.info('already transitioning to full mode');
		return (cb(null));
	}
	log.info('changing to full mode');

	doUpgradeToFullMode.call(self, cb);

	return (null);
};


/*
 * Load objects from an old storage location (e.g. local storage) to a new
 * storage location (e.g. moray).
 *
 * The caller must specify a function to create an object in the new location
 * (createfunc) and can optionally specify a function which modifies an object
 * before it's written to the new location.
 */
function loadObjects(opts, cb) {
	var self = this;
	var log = self.log;

	assert.object(opts, 'opts');
	assert.string(opts.bucket, 'bucket');
	assert.func(opts.createfunc, 'createfunc');
	assert.optionalFunc(opts.modfunc, 'modfunc');
	assert.func(cb, 'cb');

	var bucket = opts.bucket;
	var createfunc = opts.createfunc;
	var modfunc = opts.modfunc;

	// Because we're reading from the transition stor at this point, this
	// "just works".  The wonky thing is that it will rewrite all the
	// objects in old.  But since the DBs should be in sync, it's just
	// extra writes.
	self.stor.listObjectValues(bucket, {}, {}, function (err, objs) {
		if (err) {
			log.error(err,
			    'failed to read objects from %s', bucket);
			return (cb(err));
		}

		if (modfunc)
			objs = objs.map(modfunc);

		log.debug({ objs: objs },
		    'loading objects into moray bucket %s', bucket);

		vasync.forEachParallel({
			func: function (obj, subcb) {
				createfunc.call(self, obj, function (suberr) {
					subcb(suberr);
				});
			},
			inputs: objs
		}, function (suberr) {
			cb(suberr);
		});
	});
}

function doUpgradeToFullMode(cb) {
	var self = this;
	var log = self.log;
	var config = self.config;

	self.proto_transition = true;
	var new_stor = null;
	var old_stor = self.stor;
	var ml_stor = null;

	async.waterfall([
		function doInitFullClients(subcb) {
			initFullClients.call(self, config, subcb);
		},
		function initMorayStor(subcb) {
			log.info('initializing moray storage client');
			new_stor = new MorayStorage(config);
			new_stor.init(subcb);
		},
		function setTransitionStor(subcb) {
			log.info('setting transitional storage');
			self.stor = new TransitionStorage({
				'log': log,
				'old': old_stor,
				'new': new_stor
			});
			subcb();
		},
		function loadManifests(subcb) {
			log.info('loading manifests from local storage');
			loadObjects.call(self, {
				'bucket': BUCKETS.manifests,
				'createfunc': self.createManifest
			}, subcb);
		},
		function loadApps(subcb) {
			log.info('loading applications from local storage');
			loadObjects.call(self, {
				'bucket': BUCKETS.applications,
				'createfunc': function (app, subcb2) {
					self.createApplication(app, subcb2);
				}
			}, subcb);
		},
		function loadSvcs(subcb) {
			log.info('loading services from local storage');
			loadObjects.call(self, {
				'bucket': BUCKETS.services,
				'createfunc': self.createService
			}, subcb);
		},
		function loadInsts(subcb) {
			log.info('loading instances from local storage');
			loadObjects.call(self, {
				'bucket': BUCKETS.instances,
				'createfunc': self.createInstance,
				'modfunc': function (obj) {
					obj.exists = true;
					return (obj);
				}
			}, subcb);
		},
		function initMorayLocalStore(subcb) {
			log.info('initing moray + local stor');
			ml_stor = new MorayLocalStorage({
				'log': log,
				'buckets': BUCKETS,
				'moray': new_stor,
				'local': old_stor
			});
			ml_stor.init(subcb);
		},
		function clearProtoModeMarker(subcb) {
			// This should be the *last* thing, so that we don't
			// have to worry about running 'mdata-put' on a
			// rollback.
			var cmd = '/usr/sbin/mdata-delete SAPI_PROTO_MODE';
			exec(cmd, function (err, stdout, stderr) {
				if (err) {
				    log.error({
					err: err,
					stdout: stdout,
					stderr: stderr
				    }, 'error mdata-delete\'ing ' +
				    'SAPI_PROTO_MODE');
				    return (subcb(err));
				}
				log.info('mdata-delete\'d SAPI_PROTO_MODE');
				subcb();
			});
		}
	], function (err) {
		if (err) {
			/*
			 * Resume using the local storage backend and close the
			 * moray storage backend.
			 */
			if (ml_stor) {
				ml_stor.close();
			}
			self.stor = old_stor;
			new_stor.close();

			log.error(err, 'failed to transition to full mode');

			// XXX Should I close the full clients here?  Probably
			// should, but I don't think it's strictly necessary.
		} else {
			self.moray_stor = new_stor;
			self.stor = ml_stor;
			self.proto_mode = false;
			log.info('upgraded to full mode');
		}

		self.proto_transition = false;
		return (cb(err));
	});
}


// -- Cache

Model.prototype.syncStor = function syncStor(cb) {
	var self = this;
	assert.func(cb, 'cb');
	if (typeof (self.stor.sync) === 'function') {
		self.stor.sync(cb);
	} else {
		process.nextTick(cb);
	}
};


module.exports = Model;
