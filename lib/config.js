/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * lib/configs.js: manage configuration manifests
 */


module.exports.assemble = function assemble(app, svc, inst) {
	var self = this;
	var log = self.log;

	// XXX might make more sense to have an object of configs, not an array.
	// that way it could be indexed by name to allow inheritance.

	var configs = [];

	if (app.configs)
		configs.concat(app.configs);
	if (svc.configs)
		configs.concat(svc.configs);
	if (inst.configs)
		configs.concat(inst.configs);

	log.info({ configs: configs }, 'assembled configs for zone');

	return (configs);
};
