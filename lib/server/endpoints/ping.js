/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/server/endpoints/ping.js: SAPI ping
 */

var restify = require('restify');


function Ping() {}

Ping.get = function (req, res, next) {
	var model = this.model;

	model.isProtoMode(function (err, proto_mode) {
		if (err) {
			model.log.error(err, 'failed to get mode');
			return (next(err));
		}

		model.stor.ping(function (err2) {
			var storAvailable = true;
			if (err2) {
				storAvailable = false;
			}
			res.send(storAvailable ? 200 : 500, {
				'mode': proto_mode ? 'proto' : 'full',
				'storType': model.stor.constructor.name,
				'storAvailable': storAvailable
			});
			return (next());
		});
	});
};


function attachTo(sapi, model) {
	var toModel = {
		model: model
	};

	sapi.get({ path: '/ping', name: 'Ping' },
		Ping.get.bind(toModel));
}

exports.attachTo = attachTo;
