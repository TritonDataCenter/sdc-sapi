/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/server/attributes.js: manage attributes on SAPI objects
 *
 * There are three main fields on each SAPI object:
 *
 *	params		Zone parameters used for VMAPI.createVm().
 *
 *	metadata	Key-value pairs used to render configuration files
 *
 *	manifests	A list of configuration manifests.  These along with the
 *			metadata kvpairs will generate a zone's configuration
 *			files.
 */

var assert = require('assert-plus');
var async = require('async');
var common = require('./common');
var restify = require('restify');
var vasync = require('vasync');

var sprintf = require('util').format;

var mod_errors = require('./errors');


module.exports = Attributes;

function Attributes(config) {
	assert.object(config, 'config');
	assert.object(config.log, 'config.log');
	assert.object(config.model, 'config.model');

	this.log = config.log;
	this.model = config.model;
}


// -- Functions to manipulate object attributes

var FIELDS = [ 'params', 'metadata', 'manifests' ];

function updateAttributes(obj, changes) {
	assert.object(obj, 'obj');
	assert.object(changes, 'changes');

	FIELDS.forEach(function (field) {
		if (changes[field]) {
			if (!obj[field])
				obj[field] = {};

			Object.keys(changes[field]).forEach(function (key) {
				obj[field][key] = changes[field][key];
			});
		}
	});

	return (obj);
}

function replaceAttributes(obj, changes) {
	assert.object(obj, 'obj');
	assert.object(changes, 'changes');

	FIELDS.forEach(function (field) {
		if (changes[field])
			obj[field] = changes[field];
	});

	return (obj);
}

function deleteAttributes(obj, changes) {
	assert.object(obj, 'obj');
	assert.object(changes, 'changes');

	FIELDS.forEach(function (field) {
		if (changes[field]) {
			if (!obj[field])
				obj[field] = {};

			Object.keys(changes[field]).forEach(function (key) {
				delete obj[field][key];
			});
		}
	});

	return (obj);
}

Attributes.prototype.applyChange = function applyChange(obj, change, action) {
	assert.object(obj, 'obj');
	assert.object(change, 'change');
	assert.ok(action === 'update' ||
	    action === 'replace' ||
	    action === 'delete');

	var updatefunc;
	if (action === 'update')
		updatefunc = updateAttributes;
	else if (action === 'replace')
		updatefunc = replaceAttributes;
	else if (action === 'delete')
		updatefunc = deleteAttributes;

	return (updatefunc(obj, change));
};


function assemble(app, svc, inst, field) {
	var obj = {};

	if (app[field]) {
		Object.keys(app[field]).forEach(function (key) {
			obj[key] = app[field][key];
		});
	}

	if (svc[field]) {
		Object.keys(svc[field]).forEach(function (key) {
			obj[key] = svc[field][key];
		});
	}

	if (inst[field]) {
		Object.keys(inst[field]).forEach(function (key) {
			obj[key] = inst[field][key];
		});
	}

	return (obj);
}

/*
 * Given an application, service, and instance, assemble the union of attributes
 * from those respective objects.
 *
 * For example, this function is used to generate the zone parameters passed to
 * VMAPI from app.params, svc.params, and inst.params.  The instance params
 * override the service parameters, and the service parameters override the
 * application parameters.
 */
function assembleAttributes(app, svc, inst) {
	var attributes = {};

	attributes.params = assemble(app, svc, inst, 'params');
	attributes.metadata = assemble(app, svc, inst, 'metadata');
	attributes.manifests = assemble(app, svc, inst, 'manifests');

	return (attributes);
}



// -- Manifest and metadata manipulation

function resolveManifest(uuid, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');

	this.model.getManifest(uuid, function (err, mfest) {
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
		func: self.model.getManifest.bind(self.model),
		inputs: uuids
	}, function (err, results) {
		if (err)
			return (cb(err));
		return (cb(null, results.successes));
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
	    'user-script', 'assets-ip' ];

	allowed_keys.forEach(function (key) {
		if (metadata && metadata[key])
			customer_metadata[key] = metadata[key];
	});

	return (customer_metadata);
}

Attributes.prototype.generateZoneParamsAndConfig = generateZoneParamsAndConfig;
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

			self.model.getInstance(zoneuuid, function (err, inst) {
				if (err)
					return (subcb(err));

				opts.instance = inst;
				return (subcb(null));
			});
		},

		function (subcb) {
			if (opts.service)
				return (subcb(null));

			var inst = opts.instance;
			var uuid = inst.service_uuid;

			self.model.getService(uuid, function (err, svc) {
				if (err)
					return (subcb(err));

				opts.service = svc;
				return (subcb(null));
			});
		},

		function (subcb) {
			if (opts.application)
				return (subcb(null));

			var svc = opts.service;
			var uuid = svc.application_uuid;

			self.model.getApplication(uuid, function (err, app) {
				if (err)
					subcb(err);

				opts.application = app;
				return (subcb(null));
			});
		},

		function (subcb) {
			var attributes = assembleAttributes(
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
				params.server_uuid = self.model.server_uuid;

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
				 * zone's metadata.  It clutters up the log, and
				 * encourages consumers to use it in an
				 * inappropriate way.  The authoritative
				 * user-script will come from the metadata API,
				 * not SAPI.
				 */
				delete config.metadata['user-script'];

				return (subcb(null, params, config));
			});
		},

		function (params, config, subcb) {
			assert.object(params, 'params');
			assert.object(config, 'config');
			assert.func(subcb, 'subcb');

			if (!params.networks)
				return (subcb(null, params, config));

			// XXX Can I move this to just before provisioning?
			resolveNetworks.call(self, params.networks,
			    function (err, uuids) {
				if (err &&
				    err.name !== 'UnsupportedOperationError') {
					log.error(err, 'failed to resolve ' +
					    'networks');
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
					assert.equal(self.model.mode,
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


// -- Validation helper functions

function validManifests(manifests, cb) {
	var self = this;

	assert.object(manifests, 'manifests');

	var uuids = [];
	Object.keys(manifests).forEach(function (key) {
		assert.string(manifests[key], 'manifests[key]');
		uuids.push(manifests[key]);
	});

	vasync.forEachParallel({
		func: function (uuid, subcb) {
			self.model.getManifest(uuid, function (err) {
				subcb(err);
			});
		},
		inputs: uuids
	}, function (err) {
		return (cb(err));
	});
}

function validImage(uuid, cb) {
	var log = this.log;
	var imgapi = this.model.imgapi;

	assert.string(uuid, 'uuid');

	if (this.model.mode === common.PROTO_MODE) {
		log.info('in proto mode, assume image %s is valid', uuid);
		return (cb(null));
	}

	imgapi.getImage(uuid, function (err, image) {
		if (err || !image) {
			var msg = sprintf('image %s doesn\'t exist', uuid);
			log.error(err, msg);
			return (cb(new Error(msg)));
		}

		return (cb(null));
	});

	return (null);
}

function validOwnerUuid(owner_uuid, cb) {
	var log = this.log;
	var ufds = this.model.ufds;

	assert.string(owner_uuid, 'owner_uuid');

	if (this.model.mode === common.PROTO_MODE) {
		log.info('in proto mode, assume user %s is valid', owner_uuid);
		return (cb(null));
	}

	ufds.getUser(owner_uuid, function (err, user) {
		if (err) {
			log.error(err, 'failed to lookup user %s', owner_uuid);
			return (cb(err));
		}

		log.info({ user: user }, 'found owner_uuid %s', owner_uuid);

		return (cb(null));
	});

	return (null);
}

function validParams(params, cb) {
	var self = this;
	var log = self.log;

	assert.object(params, 'params');

	async.waterfall([
		function (subcb) {
			if (!params.image_uuid)
				return (subcb(null));
			validImage.call(self, params.image_uuid,
			    function (err) {
				subcb(err);
			});
		},
		function (subcb) {
			if (!params.networks)
				return (subcb(null));

			resolveNetworks.call(self, params.networks,
			    function (err) {
				if (err &&
				    err.name === 'UnsupportedOperationError' &&
				    self.model.mode === common.PROTO_MODE) {
					log.info('skipping validation of ' +
					    'network names in proto mode');
					err = null;
				}

				return (subcb(err));
			});

			return (null);
		}
	], function (err) {
		return (cb(err));
	});

	return (null);
}

/*
 * General validation for params and metadata which applies to all applications,
 * services, and instances.
 */
Attributes.prototype.validate = function validate(obj, opts, cb) {
	var self = this;

	assert.object(obj, 'obj');

	if (arguments.length === 2) {
		cb = opts;
		opts = {};
	}

	assert.object(opts, 'opts');
	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			if (!obj.owner_uuid)
				return (subcb(null));
			if (opts.skipOwnerCheck)
				return (subcb(null));
			validOwnerUuid.call(self, obj.owner_uuid, subcb);
		},
		function (subcb) {
			if (!obj.params)
				return (subcb(null));
			validParams.call(self, obj.params, function (err) {
				subcb(err);
			});
		},
		function (subcb) {
			if (!obj.manifests)
				return (subcb(null));
			validManifests.call(self, obj.manifests,
			    function (err) {
				subcb(err);
			});
		}
	], cb);
};


// -- Other helper functions

/*
 * Resolve an array of network names (e.g., "admin") to NAPI UUIDs.  If the
 * input argument is an array of objects, assume that these are the actual
 * network UUIDs and don't resolve the network names.
 */
function resolveNetworks(names, cb) {
	var log = this.log;

	if (this.model.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'NAPI not available in proto mode')));
	}

	if (names.length > 0) {
		var first = names[0];

		if (typeof (first) !== 'string') {
			log.info('resolveNetworks() passed an array of ' +
			    'objects, assuming they\'re proper NAPI networks');
			return (cb(null, names));
		}
	}

	this.model.napi.listNetworks({}, function (err, networks) {
		if (err) {
			log.error(err, 'failed to list networks');
			return (cb(err));
		}

		var uuids = [];

		names.forEach(function (name) {
			networks.forEach(function (network) {
				if (name === network.name)
					uuids.push(network.uuid);
			});
		});

		if (names.length !== uuids.length) {
			var msg = 'invalid network name';
			log.error(msg);
			return (cb(new Error(msg)));
		}

		log.info({
		    names: names,
		    uuids: uuids
		}, 'resolved network names');

		return (cb(null, uuids));
	});

	return (null);
}
