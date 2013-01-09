/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 */

var async = require('async');
var assert = require('assert-plus');
var moray = require('moray');
var sdc = require('sdc-clients');
var node_uuid = require('node-uuid');
var vasync = require('vasync');

var sprintf = require('util').format;

var APPLICATIONS = 'sapi_applications';
var SERVICES = 'sapi_services';
var INSTANCES = 'sapi_instances';


// -- Constructor and initialization routines

function Model(config) {
	this.config = config;
	this.log = config.log;

	this.servers = [];
}

Model.prototype.connect = function (cb) {
	var self = this;
	var log = self.log;

	self.moray = moray.createClient({
		host: '10.2.206.9',
		port: 2020,
		log: log,
		noCache: true,
		connectTimeout: 10000,
		retry: {
			retries: Infinity,
			minTimeout: 1000,
			maxTimeout: 60000
		}
	});

	self.ufds = new sdc.UFDS({
	    log: log,
	    url: 'ldaps://10.2.206.10',
	    bindDN: 'cn=root',
	    bindPassword: 'secret'
	});

	self.moray.on('connect', function () {
		return (cb(null));
	});
};

Model.prototype.initBuckets = function (cb) {
	var self = this;

	var cfg = {
		index: {
			uuid: {
				type: 'string',
				unique: true
			}
		}
	};

	vasync.forEachParallel({
		func: function (bucket, subcb) {
			createBucket.call(self, bucket, cfg, subcb);
		},
		inputs: [ APPLICATIONS, SERVICES, INSTANCES ]
	}, function (err, results) {
		return (cb(err));
	});
};


// -- Helper functions

function validOwnerUUID(owner_uuid, cb) {
	var self = this;
	var log = self.log;

	assert.string(owner_uuid, 'owner_uuid');

	self.ufds.getUser(owner_uuid, function (err, user) {
		if (err) {
			log.error(err, 'failed to lookup user %s', owner_uuid);
			return (cb(null, false));
		}

		log.info({ user: user }, 'found owner_uuid %s', owner_uuid);

		return (cb(null, true));
	});
}

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

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!app.uuid) {
		app.uuid = node_uuid.v4();
	}

	async.waterfall([
		function (subcb) {
			validOwnerUUID.call(self, app.owner_uuid,
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
		log.info({ app: app }, 'created application');
		cb(err, app);
	});
};

Model.prototype.listApplications = function (cb) {
	listObjects.call(this, APPLICATIONS, cb);
};

Model.prototype.getApplication = function (uuid, cb) {
	getObject.call(this, APPLICATIONS, uuid, cb);
};

Model.prototype.delApplication = function (uuid, cb) {
	var self = this;
	self.moray.delObject(APPLICATIONS, uuid, {}, cb);
};


// -- Services

/*
 * Create a service.
 */
Model.prototype.createService = function (service, cb) {
	var self = this;
	var log = self.log;

	assert.object(service, 'service');
	assert.string(service.name, 'service.name');
	assert.string(service.application_uuid, 'service.application_uuid');

	/*
	 * If the caller hasn't provided a UUID, generate one here.
	 */
	if (!service.uuid)
		service.uuid = node_uuid.v4();

	async.waterfall([
		function (subcb) {
			var app_uuid = service.application_uuid;

			self.getApplication(app_uuid, function (err) {
				if (err) {
					log.error(err, 'application %s ' +
					    'doesn\'t exist', app_uuid);
					return (subcb(err));
				}

				return (subcb(null));
			});
		},
		function (subcb) {
			self.moray.putObject(SERVICES, service.uuid, service,
			    function (err) {
				if (err) {
					log.error(err, 'failed to put ' +
					    'service %s', service.name);
					return (subcb(err));
				}

				return (subcb(null));
			});
		}

	], function (err, result) {
		if (!err)
			log.info({ service: service }, 'created service');
		cb(err, service);
	});
};

Model.prototype.listServices = function (cb) {
	listObjects.call(this, SERVICES, cb);
};

Model.prototype.getService = function (uuid, cb) {
	getObject.call(this, SERVICES, uuid, cb);
};

Model.prototype.delService = function (uuid, cb) {
	var self = this;
	self.moray.delObject(SERVICES, uuid, {}, cb);
};


// -- Instances

// XXX Not yet implemented


module.exports = Model;
