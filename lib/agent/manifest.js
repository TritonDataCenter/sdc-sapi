/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/manifest.js: read manifests from the metadata API
 */

var async = require('async');
var sprintf = require('util').format;
var vasync = require('vasync');

var MANIFESTS = 'config_manifests';
var MDATA_KEYS = 'metadata_keys';


function findManifestNames(cb) {
	var self = this;
	var log = self.log;

	self.mdata.get.call(self, MANIFESTS, function (err, res) {
		if (err) {
			log.error(err, 'failed to read list of manifests');
			return (cb(err));
		}

		return (cb(err, res));
	});
}

function readConfigManifest(name, cb) {
	var self = this;
	var log = self.log;

	self.mdata.get.call(self, name, function (err, manifest) {
		if (err) {
			log.error(err, 'failed to get metadata for key "%s"',
			    name);
			return (cb(err));
		}

		return (cb(null, manifest));
	});
}

function readConfigManifests(names, cb) {
	var self = this;

	vasync.forEachParallel({
		func: function (name, subcb) {
			readConfigManifest.call(self, name, subcb);
		},
		inputs: names
	}, function (err, results) {
		if (err)
			return (cb(err));

		var manifests = [];

		results.operations.forEach(function (op) {
			manifests.push(op.result);
		});

		return (cb(err, manifests));
	});
}

module.exports.readAll = function readAll(cb) {
	var self = this;
	var log = self.log;

	async.waterfall([
		function (subcb) {
			findManifestNames.call(self, subcb);
		},
		function (names, subcb) {
			readConfigManifests.call(self, names, subcb);
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
};
