/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
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
			self.model.close();
			subcb();
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
		log: options.log
	});

	server.use(restify.acceptParser(server.acceptable));
	server.use(restify.authorizationParser());
	server.use(restify.dateParser());
	server.use(restify.queryParser());
	server.use(restify.bodyParser());
	server.on('after', restify.auditLogger({ log: server.log }));

	endpoints.attachTo(server, options.model);

	// Pseudo-W3C (not quite) logging.
	server.on('after', function (req, res, name) {
		options.log.info('[%s] %s "%s %s" (%s)', new Date(),
		    res.statusCode, req.method, req.url, name);
	});

	server.on('uncaughtException', function (req, res, route, err) {
		req.log.error(err);
		res.send(err);
	});

	return (server);
}

SAPI.prototype.registerModeChangeCallback = registerModeChangeCallback;

function registerModeChangeCallback(cb, context) {
	var log = this.log;

	this.model.registerModeChangeCallback(cb, context);
	log.info('mode change callback registered');
}

module.exports = SAPI;
