/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/server/sapi.js: SAPI server initialization and shutdown
 */

var assert = require('assert-plus');
var async = require('async');
var http = require('http');
var https = require('https');
var restify = require('restify');

var endpoints = require('./endpoints');
var Model = require('./model');

function SAPI(config) {
	assert.object(config.log, 'config.log');

	this.config = config;
	this.log = config.log;

	/* Default to listening on port 80 */
	if (!this.config.port)
		this.config.port = 80;

	this.model = new Model(this.config);
}

SAPI.prototype.start = function start(cb) {
	var self = this;
	var log = self.log;

	http.globalAgent.maxSockets = self.config.maxHttpSockets || 100;
	https.globalAgent.maxSockets = self.config.maxHttpSockets || 100;

	async.waterfall([
		function (subcb) {
			self.model.initClients(subcb);
		},
		function (subcb) {
			var server_opts = {};
			server_opts.model = self.model;
			server_opts.log = self.log;

			var server = self.server = createServer(server_opts);

			server.listen(self.config.port, function () {
				log.info('%s listening at %s',
				    server.name, server.url);
				subcb();
			});
		}
	], cb);
};

SAPI.prototype.shutdown = function shutdown(cb) {
	var self = this;
	var log = self.log;

	log.info('starting shutdown');

	async.parallel([
		function (subcb) {
			self.model.close(subcb);
		},
		function (subcb) {
			self.server.close(subcb);
		}
	], function () {
		log.info('shutdown completed');
		cb();
	});
};

function createServer(options) {
	var server = restify.createServer({
		name: 'Services API',
		log: options.log,
		version: ['1.0.0', '2.0.0']
	});

	server.pre(function (req, res, next) {
		/**
		 * If the client does not set Accept-Version, then we default
		 * the header to "~1".
		 *
		 * *Could* do:
		 *    req.headers['accept-version'] = '~1'
		 * but that lies in the audit log. Would like a
		 * `req.setVersion()` in restify instead of hacking private
		 * `req._version`.
		 */
		if (req.headers['accept-version'] === undefined) {
			req._version = '~1';
		}

		next();
	});

	server.use(restify.acceptParser(server.acceptable));
	server.use(restify.authorizationParser());
	server.use(restify.dateParser());
	server.use(restify.queryParser());
	server.use(restify.bodyParser());
	server.use(restify.requestLogger());
	server.on('after', function (req, res, route, err) {
		// Skip logging some high frequency or unimportant endpoints to
		// keep log noise down.
		var method = req.method;
		var pth = req.path();
		if (method === 'GET' && pth.slice(0, 9) === '/configs/') {
			return;
		}
		// Successful GET res bodies are uninteresting and *big*.
		var body = !(method === 'GET' &&
		    Math.floor(res.statusCode / 100) === 2);

		restify.auditLogger({
		    log: req.log.child(
			{route: route && route.name || route}, true),
		    body: body
		})(req, res, route, err);
	});

	endpoints.attachTo(server, options.model);

	server.on('uncaughtException', function (req, res, route, err) {
		req.log.error({
			req: req,
			res: res,
			route: route,
			err: err
		}, 'uncaught exception');
		if (!res.headersSent) {
			req.log.error('sending error response from uncaught ' +
				'exception');
			res.send(err);
		}
	});

	return (server);
}


module.exports = SAPI;
