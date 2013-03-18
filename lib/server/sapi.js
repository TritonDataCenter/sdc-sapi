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

var Logger = require('bunyan');

var endpoints = require('./endpoints');
var Model = require('./model');

function SAPI(config) {
	this.config = config;

	/* Default to listening on port 80 */
	if (!this.config.port)
		this.config.port = 80;

	assert.object(config.log_options);
	config.log_options.serializers = Logger.stdSerializers;

	this.log = new Logger(config.log_options);

	// XXX Need some sort of top-level callback for when the mode changes.
	// That way, $TOP/server.js can rewrite the config file with mode: full.

	/*
	 * Attach the initialized Logger to the config object so all SDC clients
	 * can use the same log instance.
	 */
	this.config.log = this.log;

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

module.exports = SAPI;
