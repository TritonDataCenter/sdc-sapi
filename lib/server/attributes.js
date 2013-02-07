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
 *	configs		A list of configuration manifests.  These along with the
 *			metadata kvpairs will generate a zone's configuration
 *			files.
 */

var assert = require('assert-plus');


exports.updateAttributes = function updateAttributes(obj, changes) {
	assert.object(obj, 'obj');
	assert.object(changes, 'changes');

	var fields = [ 'params', 'metadata' ];

	fields.forEach(function (field) {
		if (changes[field]) {
			if (!obj[field])
				obj[field] = {};

			Object.keys(changes[field]).forEach(function (key) {
				obj[field][key] = changes[field][key];
			});
		}
	});

	if (changes.configs) {
		if (!obj.configs || obj.configs.length === 0)
			obj.configs = changes.configs;
		else {
			changes.configs.forEach(function (config_uuid) {
				var exists = false;

				obj.configs.forEach(function (uuid) {
					exists = exists ||
					    config_uuid === uuid;
				});

				if (!exists)
					obj.configs.push(config_uuid);
			});
		}
	}

	return (obj);
};

exports.replaceAttributes = function replaceAttributes(obj, changes) {
	assert.object(obj, 'obj');
	assert.object(changes, 'changes');

	var fields = [ 'params', 'metadata', 'configs' ];

	fields.forEach(function (field) {
		if (changes[field])
			obj[field] = changes[field];
	});

	return (obj);
};

exports.deleteAttributes = function deleteAttributes(obj, changes) {
	assert.object(obj, 'obj');
	assert.object(changes, 'changes');

	var fields = [ 'params', 'metadata' ];

	fields.forEach(function (field) {
		if (changes[field]) {
			if (!obj[field])
				obj[field] = {};

			Object.keys(changes[field]).forEach(function (key) {
				delete obj[field][key];
			});
		}
	});

	if (changes.configs) {
		if (obj.configs && obj.configs.length > 0) {
			changes.configs.forEach(function (uuid) {
				var idx = -1;

				for (var i = 0; i < obj.configs.length; i++) {
					if (obj.configs[i] === uuid)
						idx = i;
				}

				if (idx != 1) {
					obj.configs =
					    obj.configs.splice(idx, 1);
				}
			});
		}
	}

	return (obj);
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

// XXX maybe configs should be inherited?
function concatConfigs(app, svc, inst) {
	var config_uuids = [];

	if (app.configs)
		config_uuids = config_uuids.concat(app.configs);
	if (svc.configs)
		config_uuids = config_uuids.concat(svc.configs);
	if (inst.configs)
		config_uuids = config_uuids.concat(inst.configs);

	return (config_uuids);
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
exports.assembleAttributes = function assembleAttributes(app, svc, inst) {
	var attributes = {};

	attributes.params = assemble(app, svc, inst, 'params');
	attributes.metadata = assemble(app, svc, inst, 'metadata');
	attributes.configs = concatConfigs(app, svc, inst);

	return (attributes);
};
