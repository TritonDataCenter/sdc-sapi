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

	var fields = [ 'params', 'metadata', 'configs' ];

	fields.forEach(function (field) {
		if (changes[field]) {
			if (!obj[field])
				obj[field] = {};

			Object.keys(changes[field]).forEach(function (key) {
				obj[field][key] = changes[field][key];
			});
		}
	});

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

	var fields = [ 'params', 'metadata', 'configs' ];

	fields.forEach(function (field) {
		if (changes[field]) {
			if (!obj[field])
				obj[field] = {};

			Object.keys(changes[field]).forEach(function (key) {
				delete obj[field][key];
			});
		}
	});

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
	attributes.configs = assemble(app, svc, inst, 'configs');

	return (attributes);
};
