/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/model.js: SAPI's data model and associated operations on those
 *     objects.
 */

var async = require('async');
var assert = require('assert-plus');
var common = require('./common');
var fs = require('fs');
var jsprim = require('jsprim');
var LRU = require('lru-cache');
var restify = require('restify');
var sdc = require('sdc-clients');
var node_uuid = require('node-uuid');
var vasync = require('vasync');

var VMAPIPlus = require('./vmapiplus');

var LocalStorage = require('./stor/local');
var MorayStorage = require('./stor/moray');

var mod_attr = require('./attributes');
var mod_errors = require('./errors');
var mod_images = require('./images');
var mod_valid = require('./validation');

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

	assert.object(config.ufds, 'config.ufds');
	assert.string(config.ufds.url, 'config.ufds.url');
	assert.string(config.ufds.bindDN, 'config.ufds.bindDN');
	assert.string(config.ufds.bindPassword, 'config.ufds.bindPassword');

	assert.object(config.vmapi, 'config.vmapi');
	assert.string(config.vmapi.url, 'config.vmapi.url');

	assert.object(config.imgapi, 'config.imgapi');
	assert.string(config.imgapi.url, 'config.imgapi.url');

	assert.object(config.remote_imgapi, 'config.remote_imgapi');
	assert.string(config.remote_imgapi.url, 'config.remote_imgapi.url');

	assert.object(config.napi, 'config.napi');
	assert.string(config.napi.url, 'config.napi.url');

	config.moray.log = this.log;
	config.ufds.log = this.log;
	config.vmapi.log = this.log;
	config.imgapi.log = this.log;
	config.remote_imgapi.log = this.log;
	config.napi.log = this.log;

	config.moray.noCache = true;
	config.moray.connectTimeout = 10000;
	config.moray.retry = {};
	config.moray.retry.retries = Infinity;
	config.moray.retry.minTimeout = 1000;
	config.moray.retry.maxTimeout = 60000;

	this.mc_callbacks = [];
}

Model.prototype.initClients = function (cb) {
	var self = this;
	var config = self.config;
	var log = self.log;

	config.buckets = BUCKETS;

	var mode = '';
	if (config.mode)
		mode = config.mode.toLowerCase();
	if (!mode)
		mode = common.FULL_MODE;

	if (mode !== common.PROTO_MODE && mode !== common.FULL_MODE)
		throw new Error('invalid mode: ' + mode);

	self.mode = mode;
	log.info('starting in %s mode', self.mode);

	/*
	 * The config_cache contains the manifests and metadata for each zone
	 * using SAPI.  The cache can contain up to 10000 items; that can be
	 * increased if the SAPI zone contains enough memory.  However, with
	 * 10000 zones, a single SAPI zone may not be sufficient to handle the
	 * agents running in those zones.
	 */
	self.config_cache = LRU({
		max: 10000,
		length: function (item) { return (1); }
	});

	/*
	 * If starting in proto mode, there are no other services available, and
	 * application/service/instance objects are stored in local files.
	 */
	if (self.mode === common.PROTO_MODE) {
		self.stor = new LocalStorage(config);
	} else {
		self.stor = new MorayStorage(config);

		initFullClients.call(self, config);
	}

	async.parallel([
		function (subcb) {
			self.stor.init(subcb);
		},
		function (subcb) {
			if (config.server_uuid) {
				self.server_uuid = config.server_uuid;
				return (subcb(null));
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

function initFullClients(config) {
	var self = this;

	self.ufds = new sdc.UFDS(config.ufds);
	self.vmapi = new sdc.VMAPI(config.vmapi);
	self.imgapi = new sdc.IMGAPI(config.imgapi);
	self.remote_imgapi = new sdc.IMGAPI(config.remote_imgapi);
	self.napi = new sdc.NAPI(config.napi);

	self.vmapiplus = new VMAPIPlus({
		vmapi: self.vmapi,
		log: self.log
	});
}

Model.prototype.close = function close(cb) {
	var self = this;

	async.parallel([
		function (subcb) {
			self.stor.close();
			subcb();
		},
		function (subcb) {
			var ufds = self.ufds;

			if (!ufds)
				return (subcb());

			ufds.close(function () {
				subcb();
			});
		}
	], cb);
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

function updateObject(bucket, uuid, changes, action, tries, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');
	assert.object(changes, 'changes');
	assert.string(action, 'action');
	assert.ok(action === 'update' || action === 'replace' ||
	    action === 'delete');
	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			self.stor.getObject(bucket, uuid, subcb);
		},
		function (record, subcb) {
			var updatefunc;
			if (action === 'update')
				updatefunc = mod_attr.updateAttributes;
			else if (action === 'replace')
				updatefunc = mod_attr.replaceAttributes;
			else if (action === 'delete')
				updatefunc = mod_attr.deleteAttributes;

			var obj = updatefunc.call(self, record.value, changes);

			var opts = {};
			if (record._etag)
				opts.etag = record._etag;

			self.stor.putObject(bucket, uuid, obj, opts,
			    function (err) {
				if (err && err.name === 'EtagConflictError' &&
				    tries > 0) {
					/*
					 * If the object has been modified,
					 * sleep 1 second and try the update
					 * again.
					 */
					setTimeout(updateObject.bind(self,
					    bucket, uuid, changes, action,
					    tries - 1, cb), 1000);
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

		log.debug({ obj: obj }, 'updated object');

		return (cb(null, obj));
	});
}



// -- Applications

/*
 * Create an application.  An application consists of an name and owner_uuid.
 */
Model.prototype.createApplication = function createApplication(app, cb) {
	var self = this;
	var log = self.log;

	assert.object(app, 'app');
	assert.string(app.name, 'app.name');
	assert.string(app.owner_uuid, 'app.owner_uuid');

	assert.optionalObject(app.params, 'app.params');
	assert.optionalObject(app.metadata, 'app.metadata');
	assert.optionalObject(app.manifests, 'app.manifests');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!app.uuid)
		app.uuid = node_uuid.v4();

	log.info({ app: app }, 'creating application');

	async.waterfall([
		function (subcb) {
			mod_valid.validProperties.call(self, app, subcb);
		},
		function (subcb) {
			mod_valid.validOwnerUUID.call(self, app.owner_uuid,
			    function (err, valid) {
				subcb(valid ? null : new Error(
				    'invalid user: ' + app.owner_uuid));
			});
		},
		function (subcb) {
			self.stor.putObject(BUCKETS.applications,
			    app.uuid, app, function (err) {
				if (err) {
					log.error(err, 'failed to put ' +
					    'application %s', app.name);
					return (subcb(err));
				}

				return (subcb(null));
			});
		}
	], function (err, result) {
		cb(err, app);
	});
};

Model.prototype.listApplications = function (search_opts, cb) {
	this.stor.listObjectValues(BUCKETS.applications, search_opts, cb);
};

Model.prototype.getApplication = function (uuid, cb) {
	getObjectValue.call(this, BUCKETS.applications, uuid, cb);
};

Model.prototype.updateApplication = function (uuid, changes, action, cb) {
	var self = this;
	var log = self.log;

	async.waterfall([
		function (subcb) {
			updateObject.call(self, BUCKETS.applications, uuid,
			    changes, action, 3, subcb);
		},
		function (app, subcb) {
			/*
			 * If neither the metadata nor the manifests have
			 * changed, there's no need to update any extant zones.
			 */
			if (!changes.metadata && !changes.manifests) {
				log.info('no need to update extant zones');
				return (cb(null, app));
			}

			rewriteApplicationMetadata.call(self,
			    app, function (err) {
				return (subcb(err, app));
			});

			return (null);
		}
	], cb);
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

	log.info({ svc: svc }, 'creating service');

	async.waterfall([
		function (subcb) {
			mod_valid.validProperties.call(self, svc, subcb);
		},
		function (subcb) {
			var app_uuid = svc.application_uuid;

			self.getApplication(app_uuid, function (err, app) {
				if (err || !app) {
					var msg = sprintf('application %s ' +
					    'doesn\'t exist', app_uuid);
					log.error(err, msg);
					return (subcb(new Error(msg)));
				}

				return (subcb(null));
			});
		},
		function (subcb) {
			self.stor.putObject(BUCKETS.services, svc.uuid, svc,
			    function (err) {
				if (err) {
					log.error(err, 'failed to put ' +
					    'service %s', svc.name);
					return (subcb(err));
				}

				return (subcb(null));
			});
		}
	], function (err, result) {
		if (!err)
			log.info({ svc: svc }, 'created service');
		cb(err, svc);
	});
};

Model.prototype.listServices = function (search_opts, cb) {
	this.stor.listObjectValues(BUCKETS.services, search_opts, cb);
};

Model.prototype.getService = function (uuid, cb) {
	getObjectValue.call(this, BUCKETS.services, uuid, cb);
};

Model.prototype.updateService = function (uuid, changes, action, cb) {
	var self = this;
	var log = self.log;

	async.waterfall([
		function (subcb) {
			updateObject.call(self, BUCKETS.services, uuid,
			    changes, action, 3, subcb);
		},
		function (svc, subcb) {
			/*
			 * If neither the metadata nor the manifests have
			 * changed, there's no need to update any extant zones.
			 */
			if (!changes.metadata && !changes.manifests) {
				log.info('no need to update extant zones');
				return (cb(null, svc));
			}

			var app_uuid = svc.application_uuid;

			self.getApplication(app_uuid, function (err, app) {
				return (subcb(err, app, svc));
			});
		},
		function (app, svc, subcb) {
			rewriteServiceMetadata.call(self,
			    app, svc, function (err) {
				return (subcb(err, svc));
			});
		}
	], cb);
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
	assert.optionalObject(inst.params, 'inst.params');
	assert.optionalObject(inst.metadata, 'inst.metadata');
	assert.optionalObject(inst.manifests, 'inst.manifests');
	assert.func(cb, 'cb');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!inst.uuid)
		inst.uuid = node_uuid.v4();

	log.info({ inst: inst }, 'creating instance');

	async.waterfall([
		function (subcb) {
			mod_valid.validProperties.call(self, inst, subcb);
		},
		function (subcb) {
			var svc_uuid = inst.service_uuid;

			self.getService(svc_uuid, function (err, svc) {
				if (err || !svc) {
					var msg = sprintf('service %s ' +
					    'doesn\'t exist', svc_uuid);
					log.error(err, msg);
					return (subcb(new Error(msg)));
				}

				return (subcb(null));
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

		log.info({ inst: inst }, 'created instance');
		cb(null, inst);
	});
};

Model.prototype.listInstances = function (search_opts, cb) {
	this.stor.listObjectValues(BUCKETS.instances, search_opts, cb);
};

Model.prototype.getInstance = function (uuid, cb) {
	getObjectValue.call(this, BUCKETS.instances, uuid, cb);
};

Model.prototype.getInstancePayload = function (uuid, cb) {
	var self = this;

	assert.string(uuid, 'uuid');
	assert.func(cb, 'cb');

	generateZoneParamsAndConfig.call(self, uuid, function (err, params, _) {
		cb(err, params);
	});
};

Model.prototype.updateInstance = function (uuid, changes, action, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');
	assert.object(changes, 'changes');
	assert.string(action, 'action');
	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			updateObject.call(self, BUCKETS.instances, uuid,
			    changes, action, 3, subcb);
		},
		function (inst, subcb) {
			/*
			 * If neither the metadata nor the manifests have
			 * changed, there's no need to update any extant zones.
			 */
			if (!changes.metadata && !changes.manifests) {
				log.info('no need to update extant zones');
				return (cb(null, inst));
			}

			var svc_uuid = inst.service_uuid;

			self.getService(svc_uuid, function (err, svc) {
				return (subcb(err, svc, inst));
			});
		},
		function (svc, inst, subcb) {
			var app_uuid = svc.application_uuid;

			self.getApplication(app_uuid, function (err, app) {
				return (subcb(err, app, svc, inst));
			});
		},
		function (app, svc, inst, subcb) {
			rewriteInstanceMetadata.call(self,
			    app, svc, inst, function (err) {
				return (subcb(err, inst));
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
			getObjectValue.call(self, BUCKETS.instances, uuid,
			    function (err, obj) {
				if (err)
					return (cb(err));

				if (!obj) {
					return (subcb(
					    new restify.ResourceNotFoundError(
					    'no such instance: ' + uuid)));
				}

				return (subcb(null));
			});
		},
		function (subcb) {
			if (self.mode === common.PROTO_MODE) {
				log.info('in proto mode, no VM to delete');
				return (subcb(null));
			}

			self.vmapiplus.deleteVm(uuid, function (err) {
				if (err) {
					log.error(err, 'failed to delete VM');
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
					    'delete instance object');
					return (subcb(err));
				}

				self.config_cache.del(uuid);

				return (subcb(null));
			});
		}
	], cb);
};

function deployInstance(inst, cb) {
	var self = this;

	assert.object(inst, 'inst');
	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			generateZoneParamsAndConfig.call(self,
			    inst.uuid, { instance: inst }, subcb);
		},
		function (params, _, subcb) {
			if (inst.exists)
				verifyZoneExists.call(self, inst.uuid, subcb);
			else
				provisionZone.call(self, params, subcb);
		}
	], function (err) {
		if (err)
			self.config_cache.del(inst.uuid);
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

	if (self.mode === common.PROTO_MODE) {
		log.info('skipping verification of %s since in proto mode',
		    uuid);
		return (cb(null, true));
	}

	log.info('"exists" set on instance, verifying zone %s exists', uuid);

	self.vmapi.getVm({ uuid: uuid }, function (err, vm) {
		if (err && err.name === 'ResourceNotFoundError') {
			var msg = sprintf('zone %s does not exist', uuid);
			log.warn(msg);
			return (cb(new restify.InvalidArgumentError(msg)));
		} else if (err) {
			log.error(err, 'failed to get VM %s', uuid);
			return (cb(err));
		}

		log.info('VM %s exists', uuid);
		return (cb(null));
	});

	return (null);
}

function provisionZone(params, cb) {
	var self = this;
	var log = self.log;

	assert.object(params, 'params');
	assert.string(params.uuid, 'params.uuid');

	if (self.mode === common.PROTO_MODE) {
		log.info('skipping provision of %s since in proto mode',
		    params.uuid);
		return (cb(null));
	}

	log.info('checking to see if %s already exists', params.uuid);

	self.vmapi.getVm({ uuid: params.uuid }, function (err, vm) {
		if (err && err.name === 'ResourceNotFoundError') {
			log.info({ params: params }, 'provisioning zone');
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

function rewriteApplicationMetadata(app, cb) {
	var self = this;
	var log = self.log;

	assert.object(app, 'app');
	assert.string(app.uuid, 'app.uuid');
	assert.func(cb, 'cb');

	var search_opts = {};
	search_opts.application_uuid = app.uuid;

	self.listServices(search_opts, function (err, svcs) {
		if (err) {
			log.error(err, 'failed to find services');
			return (cb(err));
		}

		vasync.forEachParallel({
			func: function (svc, subcb) {
				rewriteServiceMetadata.call(self,
				    app, svc, subcb);
			},
			inputs: svcs
		}, cb);
	});
}

function rewriteServiceMetadata(app, svc, cb) {
	var self = this;
	var log = self.log;

	assert.object(app, 'app');
	assert.string(app.uuid, 'app.uuid');
	assert.object(svc, 'svc');
	assert.string(svc.uuid, 'svc.uuid');

	var search_opts = {};
	search_opts.service_uuid = svc.uuid;

	self.listInstances(search_opts, function (err, insts) {
		if (err) {
			log.error(err, 'failed to find instances');
			return (cb(err));
		}

		vasync.forEachParallel({
			func: function (inst, subcb) {
				rewriteInstanceMetadata.call(self,
				    app, svc, inst, subcb);
			},
			inputs: insts
		}, cb);
	});
}

function rewriteInstanceMetadata(app, svc, inst, cb) {
	var self = this;

	assert.object(app, 'app');
	assert.object(svc, 'svc');
	assert.object(inst, 'inst');
	assert.string(inst.uuid, 'inst.uuid');

	var opts = {};
	opts.application = app;
	opts.service = svc;
	opts.instance = inst;

	generateZoneParamsAndConfig.call(self, inst.uuid, opts, function (err) {
		return (cb(err));
	});
}

/*
 * The config-agent inside this zone will retrieve the metadata from SAPI, so
 * there's no need to deliver that same metadata through VMAPI.  The only
 * metadata needed to bootstrap the zone's configuration is the SAPI URL and the
 * user-script.
 */
function sanitizeMetadata(metadata) {
	var customer_metadata = {};

	var allowed_keys = [ 'SAPI_URL', 'sapi_url', 'SAPI-URL', 'sapi-url',
	    'user-script' ];

	allowed_keys.forEach(function (key) {
		if (metadata && metadata[key])
			customer_metadata[key] = metadata[key];
	});

	return (customer_metadata);
}

function generateZoneParamsAndConfig(zoneuuid, opts, cb) {
	var self = this;
	var log = self.log;

	assert.string(zoneuuid, 'zoneuuid');

	if (arguments.length === 2) {
		cb = opts;
		opts = {};
	}

	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			if (opts.instance)
				return (subcb(null));

			self.getInstance(zoneuuid, function (suberr, inst) {
				if (suberr) {
					log.error(suberr, 'failed to find ' +
					    'instance %s', zoneuuid);
					return (subcb(suberr));
				}

				if (!inst) {
					return (subcb(
					    new restify.ResourceNotFoundError(
					    'no such instance: ' + zoneuuid)));
				}

				opts.instance = inst;
				assert.string(inst.service_uuid,
				    'inst.service_uuid');

				return (subcb(null));
			});
		},

		function (subcb) {
			if (opts.service)
				return (subcb(null));

			var inst = opts.instance;
			var uuid = inst.service_uuid;

			self.getService(uuid, function (suberr, svc) {
				if (suberr) {
					log.error(suberr, 'failed to find ' +
					    'service %s', uuid);
					return (subcb(suberr));
				}

				if (!svc) {
					return (subcb(
					    new restify.ResourceNotFoundError(
					    'no such service: ' + uuid)));
				}

				opts.service = svc;
				assert.string(svc.application_uuid,
				    'svc.application_uuid');

				return (subcb(null));
			});
		},

		function (subcb) {
			if (opts.application)
				return (subcb(null));

			var svc = opts.service;
			var uuid = svc.application_uuid;

			self.getApplication(uuid, function (suberr, app) {
				if (suberr) {
					log.error(suberr, 'failed to find ' +
					    'applicataion %s', uuid);
					subcb(suberr);
				}

				if (!app) {
					return (subcb(
					    new restify.ResourceNotFoundError(
					    'no such application: ' + app)));
				}

				opts.application = app;

				return (subcb(null));
			});
		},

		function (subcb) {
			var attributes = mod_attr.assembleAttributes(
			    opts.application, opts.service, opts.instance);

			var params = attributes.params;
			params.owner_uuid = opts.application.owner_uuid;
			params.uuid = opts.instance.uuid;

			/*
			 * SAPI only supports the joyent-minimal brand.
			 */
			params.brand = 'joyent-minimal';

			/*
			 * XXX If no server_uuid is specified, use the current
			 * headnode.  Really, the SAPI client should have
			 * specified either a server_uuid or a trait, but short
			 * of that, use the headnode's server_uuid so the
			 * provision will succeed.
			 */
			if (!params.server_uuid)
				params.server_uuid = self.server_uuid;

			attributes.metadata.SERVER_UUID = params.server_uuid;
			attributes.metadata.ZONE_UUID = opts.instance.uuid;

			log.debug({
				params: attributes.params,
				metadata: attributes.metadata,
				manifests: attributes.manifests
			}, 'generating zone attributes');

			resolveManifests.call(self, attributes.manifests,
			    function (err, manifests) {
				if (err)
					return (cb(err));

				assert.arrayOfObject(manifests);

				params.customer_metadata =
				    sanitizeMetadata(attributes.metadata);

				var config = {
					manifests: manifests,
					metadata: attributes.metadata
				};

				/*
				 * It's a PITA to have the user-script in the
				 * zone's metadata.  It clutters up the log,
				 * takes up space in the config_cache, and
				 * encourages consumers to use it in an
				 * inappropriate way.  The authoritative
				 * user-script will come from the metadata API,
				 * not SAPI.
				 */
				delete config.metadata['user-script'];

				self.config_cache.set(zoneuuid, config);

				return (subcb(null, params, config));
			});
		},

		function (params, config, subcb) {
			assert.object(params, 'params');
			assert.object(config, 'config');
			assert.func(subcb, 'subcb');

			if (!params.networks)
				return (subcb(null, params, config));

			mod_valid.resolveNetworks.call(self, params.networks,
			    function (err, uuids) {
				if (err &&
				    err.name !== 'UnsupportedOperationError') {
					log.error(err, 'failed to resolve ' +
					    'networks');
					self.config_cache.del(zoneuuid);
					return (subcb(err));
				}

				/*
				 * If NAPI isn't available, then just leave the
				 * network names alone without resolving them to
				 * UUIDs.  In proto mode, the zone won't
				 * actually be created.
				 */
				if (err &&
				    err.name === 'UnsupportedOperationError') {
					assert.equal(self.mode,
					    common.PROTO_MODE);
					return (subcb(null, params, config));
				}

				delete params.networks;
				params.networks = uuids;

				return (subcb(null, params, config));
			});
		}
	], cb);
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

	log.info({ mfest: mfest }, 'creating configuration manifest');

	self.stor.putObject(BUCKETS.manifests, mfest.uuid, mfest,
	    function (err) {
		if (err) {
			log.error(err, 'failed to put ' +
			    'configuration manifest %s', mfest.uuid);
			return (cb(err));
		}

		return (cb(err, mfest));
	});
};

Model.prototype.listManifests = function (cb) {
	this.stor.listObjectValues(BUCKETS.manifests, {}, cb);
};

Model.prototype.getManifest = function (uuid, cb) {
	getObjectValue.call(this, BUCKETS.manifests, uuid, cb);
};

Model.prototype.delManifest = function (uuid, cb) {
	this.stor.delObject(BUCKETS.manifests, uuid, cb);
};

function resolveManifest(uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');

	self.getManifest(uuid, function (err, mfest) {
		if (err)
			return (cb(err));

		if (!mfest) {
			var msg = sprintf('manifest %s doesn\'t exist', uuid);
			log.error(err, msg);
			return (cb(new Error(msg)));
		}

		return (cb(null, mfest));
	});
}

function resolveManifests(manifests, cb) {
	var self = this;

	assert.object(manifests, 'manifests');

	var uuids = [];
	Object.keys(manifests).forEach(function (key) {
		assert.string(manifests[key], 'manifests[key]');
		uuids.push(manifests[key]);
	});

	vasync.forEachParallel({
		func: function (uuid, subcb) {
			resolveManifest.call(self, uuid, subcb);
		},
		inputs: uuids
	}, function (err, results) {
		if (err)
			return (cb(err));

		return (cb(null, results.successes));
	});
}



// -- Images

Model.prototype.downloadImage = function downloadImage(uuid, cb) {
	var self = this;
	var log = this.log;

	var image;

	async.waterfall([
		function (subcb) {
			mod_images.get.call(self, uuid, function (err, _image) {
				if (!err && _image &&
				    _image.files.length === 1 &&
				    _image.state === 'active') {
					log.info('image %s already exists',
					    uuid);

					return (cb(null));
				}

				return (subcb(err));
			});
		},
		function (subcb) {
			mod_images.download.call(self, uuid,
			    function (err, _image) {
				image = _image;
				return (subcb(err));
			});
		},
		function (subcb) {
			mod_images.importImage.call(self, image, subcb);
		},
		function (subcb) {
			mod_images.addImageFile.call(self, image, uuid, subcb);
		},
		function (subcb) {
			mod_images.activate.call(self, uuid, subcb);
		}
	], function (err) {
		// XXX If there's an error, don't remove any image files.  That
		// way, a developer can inspect the file to see what's wrong
		// (truncated, corrupt, etc.).
		if (image && !err) {
			mod_images.cleanup.call(self, image, function (_) {
				return (cb(err));
			});
		} else {
			return (cb(err));
		}
	});
};

Model.prototype.searchImages = function searchImages(name, cb) {
	mod_images.search.call(this, name, cb);
};



// -- Configs

Model.prototype.getConfig = function getConfig(uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(uuid, 'uuid');

	/*
	 * First, look in the config_cache to see if this zone's configuration
	 * is cached.  If not, regenerate its configuration using the zone's
	 * application, service, and instance.
	 */
	var val = self.config_cache.get(uuid);

	if (val) {
		cb(null, val);
	} else {
		generateZoneParamsAndConfig.call(self, uuid,
		    function (err, _, config) {
			if (err) {
				log.error('failed to generate config');
				return (cb(err));
			}

			log.debug({ config: config }, 'generated zone config');

			return (cb(null, config));
		});
	}
};



// -- Mode

Model.prototype.getMode = function getMode(cb) {
	assert.func(cb, 'cb');
	cb(null, this.mode);
};

Model.prototype.setMode = function setMode(mode, cb) {
	var self = this;
	var log = this.log;

	assert.string('mode', mode);
	assert.func(cb, 'cb');

	mode = mode.toLowerCase();

	log.info('setting mode to %s', mode);

	if (mode !== common.PROTO_MODE && mode !== common.FULL_MODE) {
		return (cb(new restify.InvalidArgumentError(
		    'invalid mode: ' + mode)));
	}

	if (this.mode === common.FULL_MODE && mode === common.PROTO_MODE) {
		return (cb(new restify.InvalidArgumentError(
		    'cannot tranistion from full to proto mode')));
	}

	if (this.mode === mode) {
		log.info('already in mode %s', mode);
		return (cb(null));
	}

	upgradeToFullMode.call(this, function (err) {
		if (err)
			return (cb(err));

		log.info('mode upgrade completed, firing %d upgrade callbacks',
		    self.mc_callbacks.length);

		/*
		 * Once upgraded to full mode, fire any mode change callbacks
		 * which have been registered.  If any callbacks fail, ignore
		 * their errors.
		 */
		vasync.forEachParallel({
			func: function (item, subcb) {
				item.callback.call(item.context, subcb);
			},
			inputs: self.mc_callbacks
		}, function (_) {
			cb();
		});
	});

	return (null);
};

Model.prototype.registerModeChangeCallback = registerModeChangeCallback;

function registerModeChangeCallback(callback, context) {
	var log = this.log;

	this.mc_callbacks.push({
		callback: callback,
		context: context
	});

	log.info('mode change callback registered (%d total)',
	    this.mc_callbacks.length);
}



/*
 * Load objects from an old storage location (e.g. local storage) to a new
 * storage location (e.g. moray).
 *
 * The caller must specify a function to create an object in the new location
 * (createfunc) and can optionally specify a function which modifies an object
 * before it's written to the new location.
 */
function loadObjects(bucket, createfunc, modfunc, cb) {
	var self = this;
	var log = self.log;

	if (arguments.length === 3) {
		cb = modfunc;
		modfunc = null;
	}

	assert.string(bucket, 'bucket');
	assert.func(createfunc, 'createfunc');
	assert.func(cb, 'cb');

	self.old_stor.listObjectValues(bucket, {}, function (err, objs) {
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

function upgradeToFullMode(cb) {
	var self = this;
	var log = self.log;
	var config = self.config;

	self.old_stor = self.stor;

	async.waterfall([
		function (subcb) {
			initFullClients.call(self, config);

			self.mode = common.FULL_MODE;

			self.stor = new MorayStorage(config);
			self.stor.init(subcb);
		},
		function (subcb) {
			loadObjects.call(self, BUCKETS.manifests,
			    self.createManifest, subcb);
		},
		function (subcb) {
			loadObjects.call(self, BUCKETS.applications,
			    self.createApplication, subcb);
		},
		function (subcb) {
			loadObjects.call(self, BUCKETS.services,
			    self.createService, subcb);
		},
		function (subcb) {
			var addExists = function (obj) {
				obj.exists = true;
				return (obj);
			};

			loadObjects.call(self, BUCKETS.instances,
			    self.createInstance, addExists, subcb);
		}
	], function (err) {
		if (err) {
			log.error(err, 'failed to transition to full mode');
			self.mode = common.PROTO_MODE;
			// XXX Should I close the full clients here?  Probably
			// should, but I don't think it's strictly necessary.
		} else {
			log.info('transitioned to full mode');
			self.old_stor.close();
		}

		return (cb(err));
	});
}



module.exports = Model;
