/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/server/endpoints/cache.js: sync sapi local cache
 */

var restify = require('restify');


function Cache() {}

Cache.sync = function (req, res, next) {
	var model = this.model;

	model.syncStor(function (err) {
		if (err) {
			model.log.error(err, 'failed to sync stor');
			return (next(err));
		}

		res.send(204);
		return (next());
	});
};


function attachTo(sapi, model) {
	var toModel = {
		model: model
	};

	sapi.post({ path: '/cache', name: 'SyncCache' },
		Cache.sync.bind(toModel));
}

exports.attachTo = attachTo;
