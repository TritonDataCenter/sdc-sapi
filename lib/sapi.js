/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 */

var async = require('async');
var http = require('http');
var restify = require('restify');
var https = require('https');
var Logger = require('bunyan');

var endpoints = require('./endpoints');
var Model = require('./model');

function SAPI(config) {
	this.config = config;

	/* Default to listening on port 80 */
	if (!this.config.port)
		this.config.port = 80;

	this.log = new Logger({
		name: 'sapi',
		level: 'debug',
		serializers: Logger.stdSerializers
	});

	this.config.log = this.log;

	this.model = new Model(this.config);
}

SAPI.prototype.start = function (cb) {
	var self = this;
	var log = self.log;

	http.globalAgent.maxSockets = self.config.maxHttpSockets || 100;
	https.globalAgent.maxSockets = self.config.maxHttpSockets || 100;

	async.waterfall([
		function (subcb) {
			self.model.initClients(subcb);
		},
		function (subcb) {
			self.model.initBuckets(subcb);
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
	], function (err) {
		cb(err);
	});
};

function createServer(options) {
	var server = restify.createServer({
		name: 'Servces API',
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

	return (server);
}

module.exports = SAPI;
