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

var CONFIG = exports.CONFIG = 'sapi:configuration';
var MANIFESTS = exports.MANIFESTS = 'sapi:config_manifests';
var METADATA = exports.METADATA = 'sapi:metadata';
var VERSION = exports.VERSION = 'sapi:version';

var version = '1.0.0';

module.exports.serialize = serialize;
module.exports.unserialize = unserialize;


/*
 * Given the configuration manifests and metadata assmebled from a zone's
 * associated application, service, and instance, serialize that information
 * into a single object.
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
	kvpairs[METADATA] = {};

	Object.keys(metadata).forEach(function (key) {
		if (!excludeFromSerialization(key)) {
			kvpairs[METADATA][key] = metadata[key];
		}
	});

	kvpairs[MANIFESTS] = manifests;

	kvpairs[VERSION] = version;

	if (log)
		log.debug({ kvpairs: kvpairs }, 'generated zone metadata');

	return (JSON.stringify(kvpairs));
}

/*
 * The inverse of the serialize() function above.  Given an mdata interface
 * (provided through this.mdata), reconstruct a list of configuration manifests
 * and the associated metadata.
 */
function unserialize(cb) {
	var log = this.log;

	assert.object(this.mdata, 'this.mdata');

	this.mdata.get(CONFIG, function (err, config) {
		if (err) {
			if (log) {
				log.error(err,
				    'failed to get mdata key %s', CONFIG);
			}
			return (cb(err));
		}

		assert.object(config, 'config');
		assert.arrayOfObject(config[MANIFESTS], 'config[MANIFESTS]');
		assert.object(config[METADATA], 'config.metadata');

		return (cb(null, config[MANIFESTS], config[METADATA]));
	});
}


// -- Helper functions

/*
 * Certain keys shouldn't be included in the list of serialized values.  These
 * keys will still be present in the resulting customer_metadata, but the
 * config-agent will have no way of discovering the names of these keys.  In
 * other words, only keys with well-known names should be excluded.
 */
function excludeFromSerialization(key) {
	return (key.toLowerCase() === 'user-script');
}
