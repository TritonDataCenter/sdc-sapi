/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/common/manifests.js: functions to serialize and unserialize configuration
 *     manifests and the associated metadata
 */

var assert = require('assert-plus');
var async = require('async');
var jsprim = require('jsprim');
var sprintf = require('util').format;
var vasync = require('vasync');


// -- Exported interface

var MANIFESTS = exports.MANIFESTS = 'sapi:config_manifests';
var MDATA_KEYS = exports.MDATA_KEYS = 'sapi:metadata_keys';

module.exports.serialize = serialize;
module.exports.unserialize = unserialize;


/*
 * Given the configuration manifests and metadata assmebled from a zone's
 * associated application, service, and instance, serialize that information
 * into key/value pairs suitable for the metadata API.
 *
 * Since the metadata API does not support listing all the keys, the in-zone
 * agent will have to bootstrap the list of metadata keys and configuration
 * templates from certain lists with well-known names.
 */
function serialize(manifests, metadata) {
	var log = this.log;

	assert.arrayOfObject(manifests, 'manifests');
	assert.object(metadata, 'metadata');

	if (log) {
		log.debug({
		    metadata: metadata,
		    manifests: manifests
		}, 'generating zone metadata');
	}

	var kvpairs = {};

	kvpairs[MDATA_KEYS] = [];
	kvpairs[MANIFESTS] = [];

	Object.keys(metadata).forEach(function (key) {
		kvpairs[MDATA_KEYS].push(key);
		kvpairs[key] = metadata[key];
	});

	manifests.forEach(function (config) {
		var name = sprintf('%s_manifest', config.name);
		kvpairs[MANIFESTS].push(name);
		kvpairs[name] = config;
	});

	/*
	 * JSON.stringify() everything since the metadata API only supports
	 * strings.
	 */
	Object.keys(kvpairs).forEach(function (key) {
		kvpairs[key] = JSON.stringify(kvpairs[key]);
	});

	if (log)
		log.debug({ kvpairs: kvpairs }, 'generated zone metadata');

	return (kvpairs);
}

/*
 * The inverse of the serialize() function above.  Given an mdata interface
 * (provided through self.mdata), reconstruct a list of configuration manifests
 * and the associated metadata.
 */
function unserialize(cb) {
	var self = this;

	assert.object(self.mdata, 'self.mdata');

	vasync.parallel({
		funcs: [
			readManifests.bind(self),
			readMetadata.bind(self)
		]
	}, function (err, results) {
		if (err)
			return (cb(err));

		assert.ok(results.operations.length === 2);

		var manifests = results.operations[0].result;
		var metadata = results.operations[1].result;

		assert.arrayOfObject(manifests, 'manifests');
		assert.object(metadata, 'metadata');

		return (cb(null, manifests, metadata));
	});
}


// -- Helper functions

function readManifest(name, cb) {
	var self = this;
	var log = self.log;

	self.mdata.get.call(self, name, function (err, manifest) {
		if (err) {
			log.error(err, 'failed to get manifest with name "%s"',
			    name);
			return (cb(err));
		}

		return (cb(null, manifest));
	});
}

function readManifests(cb) {
	var self = this;
	var log = self.log;

	async.waterfall([
		function (subcb) {
			self.mdata.get.call(self, MANIFESTS,
			    function (err, names) {
				if (err) {
					log.error(err, 'failed to get list ' +
					    'of manifest names');
					return (subcb(err));
				}

				log.debug({ names: names },
				    'got list of manifest names');

				return (subcb(err, names));
			});
		},
		function (names, subcb) {
			vasync.forEachParallel({
				func: readManifest.bind(self),
				inputs: names
			}, function (err, results) {
				if (err)
					return (subcb(err));

				var manifests = [];

				results.operations.forEach(function (op) {
					manifests.push(op.result);
				});

				return (subcb(err, manifests));
			});
		}
	], function (err, manifests) {
		if (err) {
			log.error(err, 'failed to read all manifests');
			return (cb(err));
		}

		log.debug({ manifests: manifests },
		    'read these config manifests');

		return (cb(null, manifests));
	});
}

function readMetadata(cb) {
	var self = this;
	var log = self.log;

	assert.func(cb, 'cb');

	async.waterfall([
		function (subcb) {
			self.mdata.get.call(self, MDATA_KEYS,
			    function (err, keys) {
				if (err) {
					log.error(err, 'failed to get list ' +
					    'of metadata keys');
					return (subcb(err));
				}

				assert.arrayOfString(keys, 'keys');

				return (subcb(null, keys));
			});
		},
		function (keys, subcb) {
			self.mdata.getAll.call(self, keys,
			    function (err, values) {
				if (err)
					return (subcb(err));

				assert.ok(keys.length === values.length);

				var metadata = {};

				for (var ii = 0; ii < keys.length; ii++)
					metadata[keys[ii]] = values[ii];

				log.debug({ metadata: metadata },
				    'read metadata values');

				return (subcb(null, metadata));
			});
		}
	], cb);
}
