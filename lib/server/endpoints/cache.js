/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
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
