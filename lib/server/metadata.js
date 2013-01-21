/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/metadata.js: manage VM metadata
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');

var sprintf = require('util').format;


// XXX maybe I should be delivering both the serivce the agent from the same
// repository, as dap is doing with marlin?  What is tRent doing with amon?
var MANIFESTS = 'config_manifests';
var MDATA_KEYS = 'metadata_keys';


module.exports.assemble = function assemble(app, svc, inst) {
	assert.object(app, 'app');
	assert.optionalObject(app.metadata, 'app.metadata');
	assert.object(svc, 'svc');
	assert.optionalObject(svc.metadata, 'svc.metadata');
	assert.object(inst, 'inst');
	assert.optionalObject(inst.metadata, 'inst.metadata');

	var metadata = {};

	function copyKeys(obj) {
		if (!obj)
			return;

		Object.keys(obj).forEach(function (key) {
			metadata[key] = jsprim.deepCopy(obj[key]);
		});
	}

	copyKeys(app.metadata);
	copyKeys(svc.metadata);
	copyKeys(inst.metadata);

	return (metadata);
};

/*
 * Given the metadata and configuration manifests assmebled from a zone's
 * associated application, service, and instance, generate the actual metadata
 * key/value pairs which will be made available inside the zone.
 *
 * Since the metadata API does not support listing all the keys, the in-zone
 * agent will have to bootstrap the list of metadata keys and configuration
 * templates from certain lists with well-known names.
 */
function generateZoneMetadata(metadata, configs) {
	var log = this.log;

	assert.object(metadata, 'metadata');
	assert.arrayOfObject(configs, 'configs');

	if (log) {
		log.debug({
		    metadata: metadata,
		    configs: configs
		}, 'generating zone metadata');
	}

	var kvpairs = {};

	kvpairs[MDATA_KEYS] = [];
	kvpairs[MANIFESTS] = [];

	Object.keys(metadata).forEach(function (key) {
		kvpairs[MDATA_KEYS].push(key);
		kvpairs[key] = metadata[key];
	});

	configs.forEach(function (config) {
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
module.exports.generateZoneMetadata = generateZoneMetadata;
