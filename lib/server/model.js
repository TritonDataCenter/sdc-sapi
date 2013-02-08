/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/model.js: SAPI's data model and associated operations on those objects.
 */

var async = require('async');
var assert = require('assert-plus');
var fs = require('fs');
var jsprim = require('jsprim');
var moray = require('moray');
var sdc = require('sdc-clients');
var node_uuid = require('node-uuid');
var vasync = require('vasync');

var mod_valid = require('./validation');
var mod_manifests = require('../common/manifests');
var mod_config = require('./config');
var mod_images = require('./images');
var mod_attr = require('./attributes');

var sprintf = require('util').format;


// -- Moray bucket names

var APPLICATIONS = 'sapi_applications';
var SERVICES = 'sapi_services';
var INSTANCES = 'sapi_instances';
var CONFIG = 'sapi_config';


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
			createBucket.call(self, APPLICATIONS, basecfg, subcb);
		},
		function (subcb) {
			var cfg = jsprim.deepCopy(basecfg);
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
			createBucket.call(self, CONFIG, basecfg, subcb);
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

function listObjects(bucket, cb) {
	var self = this;

	findObjects.call(self, bucket, '(uuid=*)', cb);
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
	assert.optionalArrayOfString(app.configs, 'app.configs');

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

Model.prototype.listApplications = function (cb) {
	listObjects.call(this, APPLICATIONS, cb);
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
			 * If neither the metadata nor the configs have changed,
			 * there's no need to update any extant zones.
			 */
			if (!changes.metadata && !changes.configs) {
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
	assert.optionalArrayOfString(svc.configs, 'svc.configs');

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

Model.prototype.listServices = function (cb) {
	listObjects.call(this, SERVICES, cb);
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
			 * If neither the metadata nor the configs have changed,
			 * there's no need to update any extant zones.
			 */
			if (!changes.metadata && !changes.configs) {
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
	assert.string(inst.name, 'inst.name');
	assert.string(inst.service_uuid, 'inst.service_uuid');

	assert.optionalObject(inst.params, 'inst.params');
	assert.optionalObject(inst.metadata, 'inst.metadata');
	assert.optionalArrayOfString(inst.configs, 'inst.configs');

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
					    'instance %s', inst.name);
					return (subcb(err));
				}

				return (subcb(null));
			});
		}
	], function (err, result) {
		if (!err)
			log.info({ inst: inst }, 'created instance');
		cb(err, inst);
	});
};

Model.prototype.listInstances = function (cb) {
	listObjects.call(this, INSTANCES, cb);
};

Model.prototype.getInstance = function (uuid, cb) {
	getObject.call(this, INSTANCES, uuid, cb);
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
			 * If neither the metadata nor the configs have changed,
			 * there's no need to update any extant zones.
			 */
			if (!changes.metadata && !changes.configs) {
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
	self.moray.delObject(INSTANCES, uuid, {}, cb);
};


function deployZone(params, cb) {
	var self = this;
	var log = self.log;

	/*
	 * SAPI only supports the joyent-minimal brand.
	 */
	params.brand = 'joyent-minimal';

	// XXX Not yet implemented.  This will only work on kvm6.
	params.server_uuid = '44454c4c-4800-1034-804a-b2c04f354d31';

	log.info({ params: params }, 'provisioning zone');

	self.vmapi.createVm(params, function (err, res) {
		if (err) {
			log.error(err, 'failed to create zone');
			return (cb(err));
		}

		return (cb(null));
	});
}

Model.prototype.deployInstance = function (inst, cb) {
	var self = this;
	var log = self.log;
	var app, svc;

	assert.string(inst.service_uuid, 'inst.service_uuid');

	async.waterfall([
		function (subcb) {
			var uuid = inst.service_uuid;

			self.getService(uuid, function (suberr, result) {
				if (suberr) {
					log.error(suberr, 'failed to find ' +
					    'service %s', uuid);
					subcb(suberr);
				}

				svc = result;
				assert.string(svc.application_uuid);

				subcb(null);
			});
		},
		function (subcb) {
			var uuid = svc.application_uuid;

			self.getApplication(uuid, function (suberr, result) {
				if (suberr) {
					log.error(suberr, 'failed to find ' +
					    'applicataion %s', uuid);
					subcb(suberr);
				}

				app = result;
				subcb(null);
			});
		},
		function (subcb) {
			var attributes = mod_attr.assembleAttributes(
			    app, svc, inst);

			console.log(attributes);

			assert.object(attributes);
			assert.optionalObject(attributes.params);
			assert.optionalObject(attributes.metadata);
			assert.optionalArrayOfString(attributes.configs);

			var params = attributes.params;
			var metadata = attributes.metadata;
			var configs = attributes.configs;

			params.owner_uuid = app.owner_uuid;
			params.uuid = inst.uuid;

			log.debug({
				params: params,
				metadata: metadata,
				configs: configs
			}, 'assembled zone attributes');

			mod_config.resolveAll.call(self, configs,
			    function (err, manifests) {
				if (err)
					return (subcb(err));

				assert.arrayOfObject(manifests);

				params.customer_metadata = metadata;

				params.customer_metadata[mod_manifests.CONFIG] =
				    mod_manifests.serialize.call(
				    self, manifests, metadata);

				return (subcb(null, params));
			});
		},
		function (params, subcb) {
			mod_valid.resolveNetworks.call(self, params.networks,
			    function (err, uuids) {
				if (err)
					return (subcb(err));

				delete params.networks;
				params.networks = uuids;

				return (subcb(null, params));
			});
		},
		function (params, subcb) {
			deployZone.call(self, params, subcb);
		}
	], function (err, results) {
		if (err) {
			log.error(err, 'failed to deploy instance');
			cb(err);
		} else {
			cb(null);
		}
	});
};


function rewriteApplicationMetadata(app, cb) {
	var self = this;
	var log = self.log;

	assert.object(app, 'app');
	assert.string(app.uuid, 'app.uuid');

	var filter = sprintf('(application_uuid=%s)', app.uuid);
	findObjects.call(self, SERVICES, filter, function (err, svcs) {
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

	var filter = sprintf('(service_uuid=%s)', svc.uuid);
	findObjects.call(self, INSTANCES, filter, function (err, insts) {
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
	var self = this;
	var log = self.log;

	assert.object(app, 'app');
	assert.object(svc, 'svc');
	assert.object(inst, 'inst');
	assert.string(inst.uuid, 'inst.uuid');

	var attributes = mod_attr.assembleAttributes(app, svc, inst);

	var metadata = attributes.metadata;
	var configs = attributes.configs;

	log.debug({
		metadata: metadata,
		configs: configs
	}, 'updating zone attributes');

	mod_config.resolveAll.call(self, configs, function (err, manifests) {
		if (err)
			return (cb(err));

		assert.arrayOfObject(manifests);

		var config =
		    mod_manifests.serialize.call(
		    self, manifests, metadata);

		var customer_metadata = {};
		customer_metadata[mod_manifests.CONFIG] = config;
		customer_metadata.uuid = inst.uuid;

		log.debug({ customer_metdata: customer_metadata },
		    'updating zone\'s metadata');

		self.vmapi.setMetadata('customer_metadata',
		    customer_metadata, function (suberr) {
			if (suberr)
				log.error(suberr, 'failed to update metadata');
			return (cb(suberr));
		});

		return (null);
	});
}


// -- Configs

/*
 * Create a config object.
 */
Model.prototype.createConfig = function (cfg, cb) {
	var self = this;
	var log = self.log;

	assert.object(cfg, 'cfg');
	assert.string(cfg.name, 'cfg.name');
	assert.string(cfg.type, 'cfg.type');
	assert.string(cfg.path, 'cfg.path');
	assert.ok(cfg.template, 'cfg.template');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!cfg.uuid)
		cfg.uuid = node_uuid.v4();

	log.info({ cfg: cfg }, 'creating config object');

	self.moray.putObject(CONFIG, cfg.uuid, cfg, function (err) {
		if (err) {
			log.error(err, 'failed to put ' +
			    'config object %s', cfg.uuid);
			return (cb(err));
		}

		return (cb(err, cfg));
	});
};

Model.prototype.listConfigs = function (cb) {
	listObjects.call(this, CONFIG, cb);
};

Model.prototype.getConfig = function (uuid, cb) {
	getObject.call(this, CONFIG, uuid, cb);
};

Model.prototype.delConfig = function (uuid, cb) {
	var self = this;
	self.moray.delObject(CONFIG, uuid, {}, cb);
};



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


module.exports = Model;
