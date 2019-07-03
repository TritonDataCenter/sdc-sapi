/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * lib/server/sapi.js: SAPI server initialization and shutdown
 */

var assert = require('assert-plus');
var async = require('async');
var createMetricsManager = require('triton-metrics').createMetricsManager;
var fs = require('fs');
var http = require('http');
var https = require('https');
var os = require('os');
var restify = require('restify');
var tritonAuditLogger = require('triton-audit-logger');
var tritonTracer = require('triton-tracer');

var endpoints = require('./endpoints');
var Model = require('./model');

var VERSION = null;
var HOSTNAME = os.hostname();


// ---- internal helper functions

/**
 * Returns the current semver version stored in package.json, used for the
 * "Server" header in responses.
 *
 * @return {String} version.
 */
function serverVersion() {
    if (!VERSION) {
        var pkg = fs.readFileSync(__dirname + '/../../package.json', 'utf8');
        VERSION = JSON.parse(pkg).version;
    }

    return VERSION;
}


// ---- SAPI app object

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
        function initMetrics(subcb) {
            var config = self.config;

            self.metricsManager = createMetricsManager({
                address: config.adminIp,
                log: config.log.child({component: 'metrics'}),
                port: config.metricsPort || 8881,
                restify: restify,
                staticLabels: {
                    datacenter: config.datacenter_name,
                    instance: config.instanceUuid,
                    server: config.serverUuid,
                    service: 'sapi'
                }
            });

            self.metricsManager.createRestifyMetrics();
            self.metricsManager.listen(function metricsServerStarted() {
                subcb();
            });
        },
        function initModel(subcb) {
            self.model.initClients(
                {metricsManager: self.metricsManager}, subcb);
        },
        function (subcb) {
            var server_opts = {};
            server_opts.metricsManager = self.metricsManager;
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

    log.info('shutdown: start');
    async.parallel([
        function (subcb) {
            log.info('shutdown: closing model');
            self.model.close(subcb);
        },
        function (subcb) {
            log.info('shutdown: closing server');
            self.server.close(subcb);
        },
        function shutdownMetricsServer(subcb) {
            self.metricsManager.log.info('shutdown: closing metrics server');
            self.metricsManager.close(subcb);
        }
    ], function () {
        log.info('shutdown: complete');
        cb();
    });
};

function createServer(options) {
    var server = restify.createServer({
        name: 'sapi/' + serverVersion(),
        handleUncaughtExceptions: false,
        log: options.log,
        version: ['1.0.0', '2.0.0']
    });

    // Start the tracing backend and instrument this restify 'server'.
    tritonTracer.instrumentRestifyServer({
        server: server
    });

    server.pre(function setDefaultApiVersion(req, res, next) {
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

    // Set stock Triton service headers.
    server.use(function stdTritonResHeaders(req, res, next) {
        res.on('header', function onHeader() {
            res.header('Server', server.name);
            res.header('x-request-id', req.getId());
            res.header('x-server-name', HOSTNAME);
        });

        next();
    });

    server.use(restify.queryParser({allowDots: false, plainObjects: false}));
    server.use(restify.bodyParser());
    server.use(restify.requestLogger());
    server.on('after', options.metricsManager.collectRestifyMetrics
        .bind(options.metricsManager));

    server.on('after', tritonAuditLogger.createAuditLogHandler({
        log: options.log,
        reqBody: {
            maxLen: 1024
        },
        resBody: {},
        routeOverrides: {
            // Make the frequent `GetConfig` calls visible via `bunyan -p`.
            'getconfigs': {
                logLevel: 'debug'
            }
        }
    }));

    endpoints.attachTo(server, options.model);

    return (server);
}


module.exports = SAPI;
