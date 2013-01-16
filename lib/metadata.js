/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/metadata.js: manage VM metadata
 */

var assert = require('assert-plus');
var jsprim = require('jsprim');


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
