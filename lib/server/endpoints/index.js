/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/server/endpoints/index.js: register all SAPI endpoints
 */

var applications = require('./applications');
var cache = require('./cache');
var configs = require('./configs');
var instances = require('./instances');
var manifests = require('./manifests');
var mode = require('./mode');
var ping = require('./ping');
var services = require('./services');
var history = require('./history');

exports.attachTo = function (sapi, model) {
	sapi.post('/loglevel',
		function (req, res, next) {
			var level = req.params.level;
			model.log.debug('Setting loglevel to %s', level);
			model.log.level(level);
			res.send();
			return (next());
		});

	sapi.get('/loglevel',
		function (req, res, next) {
			res.send({ level: model.log.level() });
			return (next());
		});

	applications.attachTo(sapi, model);
	cache.attachTo(sapi, model);
	configs.attachTo(sapi, model);
	instances.attachTo(sapi, model);
	manifests.attachTo(sapi, model);
	mode.attachTo(sapi, model);
	ping.attachTo(sapi, model);
	services.attachTo(sapi, model);
	history.attachTo(sapi, model);
};
