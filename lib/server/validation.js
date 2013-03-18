/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/validation.js: validation routunes
 */

var async = require('async');
var assert = require('assert-plus');
var common = require('./common');
var moray = require('moray');
var vasync = require('vasync');

var mod_errors = require('./errors');

var sprintf = require('util').format;


exports.resolveNetworks = resolveNetworks;
exports.validOwnerUUID = validOwnerUUID;
exports.validProperties = validProperties;


/*
 * Resolve network names (e.g., "admin") to NAPI UUIDs.
 */
function resolveNetworks(names, cb) {
	var log = this.log;

	assert.arrayOfString(names, 'names');

	if (this.mode === common.PROTO_MODE) {
		return (cb(new mod_errors.UnsupportedOperationError(
		    'NAPI not available in proto mode')));
	}

	this.napi.listNetworks({}, function (err, networks) {
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

function validManifest(uuid, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');

	this.getManifest(uuid, function (err, cfg) {
		if (err || !cfg) {
			var msg = sprintf('invalid manifest: %s', uuid);
			log.error(err, msg);
			return (cb(new Error(msg)));
		}

		return (cb(null));
	});
}

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
			validManifest.call(self, uuid, subcb);
		},
		inputs: uuids
	}, function (err) {
		return (cb(err));
	});
}

function validImage(uuid, cb) {
	var log = this.log;

	assert.string(uuid, 'uuid');

	if (this.mode === common.PROTO_MODE) {
		log.info('in proto mode, assume image %s is valid', uuid);
		return (cb(null));
	}

	this.imgapi.getImage(uuid, function (err, image) {
		if (err || !image) {
			var msg = sprintf('image %s doesn\'t exist', uuid);
			log.error(err, msg);
			return (cb(new Error(msg)));
		}

		return (cb(null));
	});

	return (null);
}

function validOwnerUUID(owner_uuid, cb) {
	var log = this.log;

	assert.string(owner_uuid, 'owner_uuid');

	if (this.mode === common.PROTO_MODE) {
		log.info('in proto mode, assume user %s is valid', owner_uuid);
		return (cb(null, true));
	}

	this.ufds.getUser(owner_uuid, function (err, user) {
		if (err) {
			log.error(err, 'failed to lookup user %s', owner_uuid);
			return (cb(null, false));
		}

		// XXX this is a little wonky, perhaps just return an error in
		// the failure case?
		log.info({ user: user }, 'found owner_uuid %s', owner_uuid);

		return (cb(null, true));
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
			validImage.call(self, params.image_uuid, subcb);
			return (null);
		},
		function (subcb) {
			if (!params.networks)
				return (subcb(null));

			resolveNetworks.call(self, params.networks,
			    function (err) {
				if (err &&
				    err.name === 'UnsupportedOperationError' &&
				    self.mode === common.PROTO_MODE) {
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
function validProperties(obj, cb) {
	var self = this;

	assert.object(obj, 'obj');

	async.waterfall([
		function (subcb) {
			if (!obj.params)
				return (subcb(null));
			validParams.call(self, obj.params, subcb);
			return (null);
		},
		function (subcb) {
			if (!obj.manifests)
				return (subcb(null));
			validManifests.call(self, obj.manifests, subcb);
			return (null);
		}
	], cb);
}
