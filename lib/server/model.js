/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/model.js: SAPI's data model and associated operations on those objects.
 */

var async = require('async');
var assert = require('assert-plus');
var fs = require('fs');
var jsprim = require('jsprim');
var LRU = require('lru-cache');
var ldapjs = require('ldapjs');
var moray = require('moray');
var restify = require('restify');
var sdc = require('sdc-clients');
var node_uuid = require('node-uuid');
var vasync = require('vasync');

var VMAPIPlus = require('./vmapiplus');

var mod_valid = require('./validation');
var mod_images = require('./images');
var mod_attr = require('./attributes');

var sprintf = require('util').format;


// -- Moray bucket names

var APPLICATIONS = 'sapi_applications';
var SERVICES = 'sapi_services';
var INSTANCES = 'sapi_instances';
var MANIFESTS = 'sapi_manifests';


// -- Constructor and initialization routines

function Model(config) {
	this.config = config;
	this.log = config.log;

	assert.object(config, 'config');

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
}

Model.prototype.initClients = function (cb) {
	var self = this;
	var config = self.config;

	self.moray = moray.createClient(config.moray);
	self.ufds = new sdc.UFDS(config.ufds);
	self.vmapi = new sdc.VMAPI(config.vmapi);
	self.imgapi = new sdc.IMGAPI(config.imgapi);
	self.remote_imgapi = new sdc.IMGAPI(config.remote_imgapi);
	self.napi = new sdc.NAPI(config.napi);

	self.vmapiplus = new VMAPIPlus({
		vmapi: self.vmapi,
		log: self.log
	});

	/*
	 * The config_cache contains the manifests and metadata for each zone
	 * using SAPI.  The cache can contain up to 10000 items; that can be
	 * increased if the SAPI zone contains enough memory.  However, with
	 * 10000 zones, a single SAPI zone likely won't be sufficient to handle
	 * the agents running in those zones.
	 */
	self.config_cache = LRU({
		max: 10000,
		length: function (item) { return (1); }
	});

	self.moray.on('connect', function () {
		return (cb(null));
	});
};

Model.prototype.initBuckets = function (cb) {
	var self = this;

	var basecfg = {
		index: {
			uuid: {
				type: 'string',
				unique: true
			}
		}
	};

	async.waterfall([
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.name = {
				type: 'string'
			};
			cfg.index.owner_uuid = {
				type: 'string'
			};

			createBucket.call(self, APPLICATIONS, basecfg, subcb);
		},
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.name = {
				type: 'string'
			};
			cfg.index.application_uuid = {
				type: 'string'
			};

			createBucket.call(self, SERVICES, cfg, subcb);
		},
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
			cfg.index.service_uuid = {
				type: 'string'
			};

			createBucket.call(self, INSTANCES, cfg, subcb);
		},
		function (subcb) {
			createBucket.call(self, MANIFESTS, basecfg, subcb);
		}
	], cb);
};



// -- Helper functions

function createBucket(name, cfg, cb) {
	var self = this;
	var log = self.log;

	self.moray.getBucket(name, function (err, bucket) {
		if (!err)
			return (cb(null));

		if (err && err.name !== 'BucketNotFoundError') {
			log.error(err, 'failed to get bucket %s', name);
			return (cb(err));
		}

		self.moray.createBucket(name, cfg, function (suberr) {
			if (suberr) {
				log.error(suberr,
				    'failed to create bucket %s', name);
				return (cb(
				    new Error('failed to create bucket')));
			}

			log.info('created bucket %s', name);

			return (cb(null));
		});

		return (null);
	});
}

function findObjects(bucket, filter, cb) {
	var self = this;
	var log = self.log;

	assert.string(bucket, 'bucket');
	assert.string(filter, 'filter');
	assert.func(cb, 'cb');

	var res = self.moray.findObjects(bucket, filter, {});

	var objs = [];

	res.on('record', function (record) {
		objs.push(record.value);
	});

	res.on('error', function (err) {
		log.error(err, 'failed to list objects from bucket %s', bucket);
		return (cb(err));
	});

	res.on('end', function () {
		return (cb(null, objs));
	});
}

function listObjects(bucket, search_opts, cb) {
	var self = this;
	var log = self.log;

	assert.string(bucket, 'bucket');
	assert.object(search_opts, 'search_opts');
	assert.func(cb, 'cb');

	var filters = [ ldapjs.parseFilter('(uuid=*)') ];

	Object.keys(search_opts).forEach(function (key) {
		filters.push(new ldapjs.EqualityFilter({
			attribute: key,
			value: search_opts[key]
		}));
	});

	var filter;
	if (filters.length === 1)
		filter = filters[0];
	else
		filter = new ldapjs.AndFilter({ filters: filters });

	log.info({ filter: filter.toString() }, 'listing objects');

	findObjects.call(self, bucket, filter.toString(), cb);
}

function getObject(bucket, uuid, cb) {
	var self = this;
	var log = self.log;

	var filter = sprintf('(uuid=%s)', uuid);

	findObjects.call(self, bucket, filter, function (err, objs) {
		if (err) {
			log.error(err, 'failed to find object %s', uuid);
			cb(err);
		} else {
			cb(null, objs.length > 0 ? objs[0] : null);
		}
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
			self.moray.getObject(bucket, uuid, subcb);
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
			opts.etag = record._etag;

			self.moray.putObject(bucket, uuid, obj, opts,
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

			self.moray.getObject(bucket, uuid,
			    function (err, record) {
				subcb(err, record.value);
			});
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
Model.prototype.createApplication = function (app, cb) {
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
			self.moray.putObject(APPLICATIONS, app.uuid, app,
			    function (err) {
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
	listObjects.call(this, APPLICATIONS, search_opts, cb);
};

Model.prototype.getApplication = function (uuid, cb) {
	getObject.call(this, APPLICATIONS, uuid, cb);
};

Model.prototype.updateApplication = function (uuid, changes, action, cb) {
	var self = this;
	var log = self.log;

	async.waterfall([
		function (subcb) {
			updateObject.call(self,
			    APPLICATIONS, uuid, changes, action, 3, subcb);
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
	var self = this;
	self.moray.delObject(APPLICATIONS, uuid, {}, cb);
};



// -- Services

/*
 * Create a service.
 */
Model.prototype.createService = function (svc, cb) {
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
			self.moray.putObject(SERVICES, svc.uuid, svc,
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
	listObjects.call(this, SERVICES, search_opts, cb);
};

Model.prototype.getService = function (uuid, cb) {
	getObject.call(this, SERVICES, uuid, cb);
};

Model.prototype.updateService = function (uuid, changes, action, cb) {
	var self = this;
	var log = self.log;

	async.waterfall([
		function (subcb) {
			updateObject.call(self,
			    SERVICES, uuid, changes, action, 3, subcb);
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

			return (null);
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
	var self = this;
	self.moray.delObject(SERVICES, uuid, {}, cb);
};



// -- Instances

/*
 * Create a instance.
 */
Model.prototype.createInstance = function (inst, cb) {
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
			self.moray.putObject(INSTANCES, inst.uuid, inst,
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
			 * If any part of creating the instance fails, attempt
			 * to remove the instance object from moray.
			 */
			self.moray.delObject(INSTANCES, inst.uuid, {},
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
	listObjects.call(this, INSTANCES, search_opts, cb);
};

Model.prototype.getInstance = function (uuid, cb) {
	getObject.call(this, INSTANCES, uuid, cb);
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

	async.waterfall([
		function (subcb) {
			updateObject.call(self,
			    INSTANCES, uuid, changes, action, 3, subcb);
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

			return (null);
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

	var inst = null;

	async.waterfall([
		function (subcb) {
			self.moray.getObject(INSTANCES, uuid,
			    function (err, obj) {
				if (err)
					return (cb(err));

				inst = obj;

				if (!inst) {
					return (subcb(
					    new restify.ResourceNotFoundError(
					    'no such instance: ' + uuid)));
				}


				return (subcb(null));
			});
		},
		function (subcb) {
			self.vmapiplus.deleteVm(uuid, function (err) {
				if (err) {
					log.error(err, 'failed to delete VM');
					return (subcb(err));
				}

				self.moray.delObject(INSTANCES, uuid, {},
				    function (suberr) {
					if (suberr) {
						log.warn(suberr, 'failed to ' +
						    'delete instance object');
						return (subcb(err));
					}

					self.config_cache.del(uuid);

					return (subcb(null));
				});

				return (null);
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
			provisionZone.call(self, params, subcb);
		}
	], function (err, results) {
		if (err)
			self.config_cache.del(inst.uuid);
		cb(err);
	});
}

function provisionZone(params, cb) {
	var self = this;
	var log = self.log;

	assert.object(params, 'params');

	log.info({ params: params }, 'provisioning zone');

	self.vmapi.createVm(params, function (err, res) {
		if (err) {
			log.error(err, 'failed to create zone');
			return (cb(err));
		}

		log.info({ job: res.job_uuid }, 'provision job dispatched');

		self.vmapiplus.waitForJob(res.job_uuid,
		    function (suberr, job) {
			if (suberr)
				return (cb(suberr));

			var result = job.chain_results.pop();
			if (result.error) {
				suberr = new Error(result.error.message);
				log.error(suberr, 'failed to provision zone');
				return (cb(suberr));
			}

			cb(null);
		});
	});
}


function rewriteApplicationMetadata(app, cb) {
	var self = this;
	var log = self.log;

	assert.object(app, 'app');
	assert.string(app.uuid, 'app.uuid');

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

		return (null);
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

		return (null);
	});
}

function rewriteInstanceMetadata(app, svc, inst, cb) {
	assert.object(app, 'app');
	assert.object(svc, 'svc');
	assert.object(inst, 'inst');
	assert.string(inst.uuid, 'inst.uuid');

	var opts = {};
	opts.application = app;
	opts.service = svc;
	opts.instance = inst;

	generateZoneParamsAndConfig.call(this, inst.uuid, opts,
	    function (err) {
		return (cb(err));
	});
}

function sanitizeMetadata(metadata) {
	assert.object(metadata, 'metadata');

	var clean_metadata = {};

	Object.keys(metadata).forEach(function (key) {
		var type = typeof (metadata[key]);

		if (type === 'string' ||
		    type === 'number' ||
		    type === 'boolean')
			clean_metadata[key] = metadata[key];
	});

	return (clean_metadata);
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
			 * XXX
			 * If no server_uuid is specified, use bh1-kvm6's.  If
			 * there's no server_uuid, the provision will fail when
			 * provisioning on a headnode.
			 */
			if (!params.server_uuid) {
				params.server_uuid =
				    '44454c4c-4800-1034-804a-b2c04f354d31';
			}

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
				if (err) {
					log.error(err, 'failed to resolve ' +
					    'networks');
					self.config_cache.del(zoneuuid);
					return (subcb(err));
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
Model.prototype.createManifest = function (mfest, cb) {
	var self = this;
	var log = self.log;

	assert.object(mfest, 'mfest');
	assert.string(mfest.name, 'mfest.name');
	assert.string(mfest.path, 'mfest.path');
	assert.ok(mfest.template, 'mfest.template');
	assert.optionalString(mfest.post_cmd, 'mfest.post_cmd');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!mfest.uuid)
		mfest.uuid = node_uuid.v4();

	log.info({ mfest: mfest }, 'creating configuration manifest');

	self.moray.putObject(MANIFESTS, mfest.uuid, mfest, function (err) {
		if (err) {
			log.error(err, 'failed to put ' +
			    'configuration manifest %s', mfest.uuid);
			return (cb(err));
		}

		return (cb(err, mfest));
	});
};

Model.prototype.listManifests = function (cb) {
	listObjects.call(this, MANIFESTS, {}, cb);
};

Model.prototype.getManifest = function (uuid, cb) {
	getObject.call(this, MANIFESTS, uuid, cb);
};

Model.prototype.delManifest = function (uuid, cb) {
	var self = this;
	self.moray.delObject(MANIFESTS, uuid, {}, cb);
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

	var files;

	async.waterfall([
		function (subcb) {
			mod_images.get.call(self, uuid, function (err, image) {
				if (!err && image &&
				    image.files.length === 1 &&
				    image.state === 'active') {
					log.info('image %s already exists',
					    uuid);

					return (cb(null));
				}

				return (subcb(err));
			});
		},
		function (subcb) {
			mod_images.download.call(self, uuid,
			    function (err, res) {
				files = res;
				return (subcb(err));
			});
		},
		function (subcb) {
			assert.object(files, 'files');

			mod_images.importImage.call(self, files.manifest,
			    function (err) {
				return (subcb(err));
			});
		},
		function (subcb) {
			mod_images.addImageFile.call(self,
			    files.manifest, uuid, subcb);
		},
		function (subcb) {
			mod_images.activate.call(self, uuid, subcb);
		},
		function (subcb) {
			var inputs = [];
			Object.keys(files).forEach(function (key) {
				inputs.push(files[key]);
			});

			log.debug({ files: inputs }, 'removing files');

			vasync.forEachParallel({
				func: fs.unlink,
				inputs: inputs
			}, function (err, results) {
				if (err) {
					log.warn(err,
					    'failed to remove image files');
				}

				subcb(null);
			});
		}
	], cb);
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



module.exports = Model;
