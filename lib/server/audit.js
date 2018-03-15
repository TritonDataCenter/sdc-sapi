/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * This is an adaptation of restify/lib/plugins/audit.js (originally from
 * restify 4.x) with a number of feature additions.
 *
 * Usage:
 *
 *      server.on('after', audit.createAuditLogHandler({
 *          ...options...
 *      }));
 *
 * Features and differences:
 *
 * - Fine control on how and whether to log request and response bodies.
 *   `opts.reqBody` and `opts.resBody` can be used to independently control
 *   how the request and response bodies are logged. At its simplest,
 *   `{resBody: {}}`, will log response bodies, excluding buffers, excluding
 *   responses with GET requests with a 2xx status code, and will clip
 *   at 10k characters.
 *
 *   These replace `opts.body` from the default restify audit logger.
 *
 * - This audit logger attempts to log the req/res bodies as close to the wire
 *   as possible. `res.body` is the *formatted* response body, as opposed
 *   to the default restify audit logger which logs the response body *object*
 *   before formatting. `req.body` is the raw request body *only for restify
 *   5.x and later* (when restify made `req.rawBody` available).
 *
 * - Logged records set `audit: true`.
 *   (Note that restify's audit logger sets that *and* `_audit: true`.)
 *
 * - There is an optional `polish` function that can be passed in to customize
 *   audit log records just before they are logged by Bunyan.
 *
 * - Most options can be overridden per route name via `opts.routeOverrides`.
 *
 * See the `createAuditLogHandler` block comment for specifics.
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var restify = require('restify');

var HttpError = require('restify').HttpError;

// Default maximum length for requests/responses body that are logged.
var DEFAULT_BODY_MAX_LEN = 10 * 1024;

function auditBodyFromReq(req, bodyOpts) {
    // We want the audit log to be as close as possible to the what is on
    // the wire. Restify 5.x added support for `req.rawBody`
    // (https://github.com/restify/node-restify/issues/928). We'll use that
    // if available.
    var auditBody = req.hasOwnProperty('rawBody') ? req.rawBody : req.body;

    if (!bodyOpts.include) {
        auditBody = undefined;
    } else if (!auditBody) {
        /* jsl:pass */
    } else if (Buffer.isBuffer(auditBody) && !bodyOpts.includeBuffers) {
        auditBody = '<buffer>';
    } else if (typeof (auditBody) === 'string' &&
            auditBody.length > bodyOpts.maxLen) {
        auditBody = auditBody.slice(0, bodyOpts.maxLen)
            + '\n...<elided ' + (auditBody.length - bodyOpts.maxLen)
            + ' chars>';
    }

    return auditBody;
}

// Same as `auditBodyFromReq` plus:
// - `req._body` is trickier
// - handle `bodyOpts.includeGet2xx`.
function auditBodyFromRes(res, bodyOpts) {
    var auditBody;

    // We want the audit log to be as close as possible to the what is on
    // the wire. That means we prefer the *formatted* response body (i.e. after
    // the restify "formatter" has been applied). `res._data` holds this --
    // at least that appears to be so in restify 4.x and 6.x code.
    //
    // This differs from the core restify audit logger that uses the
    // *unformatted* response body:
    //    if (res._body instanceof HttpError) {
    //        auditBody = res._body.body;
    //    } else {
    //        auditBody = res._body;
    //    }
    //
    // One reason we want the formatted body is that we can more realistically
    // apply `maxLen`.
    auditBody = res._data;

    if (!bodyOpts.include) {
        auditBody = undefined;
    } else if (!bodyOpts.includeGet2xx && res.req.method === 'GET' &&
            (res.statusCode >= 200 && res.statusCode < 300)) {
        auditBody = undefined;
    } else if (!auditBody) {
        /* jsl:pass */
    } else if (Buffer.isBuffer(auditBody) && !bodyOpts.includeBuffers) {
        auditBody = '<buffer>';
    } else if (typeof (auditBody) === 'string' &&
            auditBody.length > bodyOpts.maxLen) {
        auditBody = auditBody.slice(0, bodyOpts.maxLen)
            + '\n...<elided ' + (auditBody.length - bodyOpts.maxLen)
            + ' chars>';
    }

    return auditBody;
}

/**
 * Manually generates a POJO from `res.getHeaderNames` and `res.getHeader`,
 * if available, falling back to deprecated `res._headers`, otherwise.
 * Intentionally does not use `res.getHeaders` to avoid deserialization
 * issues with object returned by that method.
 *
 * See https://github.com/restify/node-restify/issues/1370
 *
 * (This was lifted from restify v6.x's lib/plugins/audit.js.)
 */
function getResponseHeaders(res) {
    if (res.getHeaderNames && res.getHeader) {
        return res.getHeaderNames().reduce(function reduce(prev, curr) {
            var header = {};
            header[curr] = res.getHeader(curr);
            return Object.assign({}, prev, header);
        }, {});
    }
    return res._headers;
}


/*
 * A "bodyOpts" is one of the `opts.reqBody` or `opts.resBody` options to
 * `createAuditLogHandler`.
 */
function assertOptionalBodyOpts(bo, bodyName) {
    if (!bo) {
        return;
    }
    assert.optionalBool(bo.include, bodyName + '.include');
    assert.optionalBool(bo.includeBuffers, bodyName + '.includeBuffers');
    assert.optionalBool(bo.includeGet2xx, bodyName + '.includeGet2xx');
    assert.optionalNumber(bo.maxLen, bodyName + '.maxLen');
}

/*
 * A `routeOpts` is one of the objects specified as values to
 * `opts.routeOverrides`. The top-level `opts` to `createAuditLogHandler`
 * is also a superset of `routeOpts`.
 */
function assertRouteOpts(ro, routeName) {
    assert.optionalBool(ro.include, routeName + '.include');
    // logLevel is validated in `Normalize` section below.
    assertOptionalBodyOpts(ro.reqBody, routeName + '.reqBody');
    assertOptionalBodyOpts(ro.resBody, routeName + '.resBody');
    assert.optionalFunc(ro.polish, routeName + '.polish');
}

function normalizeRouteOpts(ro, defaults) {
    // - default 'ro.include' to true
    if (ro.include === undefined) {
        ro.include = true;
    }
    // - set `ro.logFnName`, default to "info"
    if (ro.logLevel) {
        ro.logFnName = bunyan.nameFromLevel[
            bunyan.resolveLevel(ro.logLevel)];
        assert.string(ro.logFnName, 'can resolve logLevel="' + ro.logLevel
            + '" to a Bunyan log level name');
    } else {
        ro.logFnName = 'info';
    }
    [ro.reqBody, ro.resBody].forEach(function (bodyOpt) {
        if (bodyOpt) {
            // - default `reqBody.include` and `resBody.include` to true
            if (!bodyOpt.hasOwnProperty('include')) {
                bodyOpt.include = true;
            }
            // - default `reqBody.maxLen` and `resBody.maxLen`
            if (!bodyOpt.hasOwnProperty('maxLen')) {
                bodyOpt.maxLen = DEFAULT_BODY_MAX_LEN;
            }
        }
    });
    // - inherit values from `defaultRouteOpts`
    if (defaults) {
        Object.keys(defaults).forEach(function (fieldName) {
            if (ro[fieldName] === undefined) {
                ro[fieldName] = defaults[fieldName];
            }
        });
    }
}


// ---- API

/**
 * Create an audit log handler.
 *
 * @param {Object} opts:
 *      @param {Object} opts.log - A Bunyan logger on which to log. Required.
 *      @param {Boolean} opts.include - Whether to log at all. Default true.
 *      @param {String} opts.logLevel - The bunyan log level (either the name
 *          or the integer value) at which to log. Default is "info".
 *      @param {Object} opts.reqBody - Options for logging request bodies.
 *      @param {Object} opts.resBody - Options for logging response bodies.
 *          Each of `reqBody` and `resBody` may have the following fields.
 *          All fields are optional.
 *          - {Boolean} `include` - Whether to log the body. Default is true.
 *          - {Number} `maxLen` - The maximum length of body to log.
 *            Default is 10k.
 *          - {Boolean} `includeBuffers` - Whether to log the body even if it
 *            is a Buffer. By default buffers are logged as `<buffer>`.
 *          - {Boolean} `includeGet2xx` - Whether to include response bodies
 *            for "GET" requests with a success response code (i.e. 2xx).
 *            Default is false. The reasoning is that successful GET response
 *            bodies can tend to be large and uninteresting. This field is
 *            only relevant for `opts.resBody`.
 *      @param {Function} opts.polish - A *sync* function that is called for
 *          each audit log record just before the call to log it. Called as:
 *              `function (fields, req, res, route, err)`
 *          where `fields` is the Bunyan fields object being logged. It
 *          can be changed in-place (as could `req` et al) to "polish" the
 *          audit log record.
 *      @param {Object} opts.routeOverrides - A mapping of `route.name`
 *          (recall that restify, at least v4.x, lowercases `route.name`), to
 *          overrides for any of the above options, except `log`. E.g.:
 *              {
 *                  // Exclude "GetPing" requests.
 *                  'getping': {include: false}
 *                  // Log "GetConfig" requests at DEBUG-level.
 *                  'getconfig': {logLevel: 'debug'}
 *                  // See the first 300 chars of ListInstances responses.
 *                  'listinstances': {
 *                      resBody: {
 *                          includeGet2xx: true,
 *                          maxLen: 300
 *                      }
 *                  }
 *              }
 *          Dev Note: This function modifies the `routeOverrides` objects
 *          in-place.
 * @returns {Function} A restify handler intended for `server.on('after', ...)`.
 */
function createAuditLogHandler(opts) {
    // Validate inputs.
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.optionalObject(opts.routeOverrides, 'opts.routeOverrides');
    var defaultRouteOpts = {
        include: opts.include,
        logLevel: opts.logLevel,
        reqBody: opts.reqBody,
        resBody: opts.resBody,
        polish: opts.polish
    };
    assertRouteOpts(defaultRouteOpts, 'default');
    var routeOptsFromName = opts.routeOverrides || {};
    Object.keys(routeOptsFromName).forEach(function (name) {
        assertRouteOpts(routeOptsFromName[name], 'routeOverrides.' + name);
    });

    // Normalize routeOpts objects.
    normalizeRouteOpts(defaultRouteOpts);
    Object.keys(routeOptsFromName).forEach(function (name) {
        normalizeRouteOpts(routeOptsFromName[name], defaultRouteOpts);
    });

    function routeOptsFromRoute(route) {
        return (route && route.name && routeOptsFromName[route.name] ||
            defaultRouteOpts);
    }

    var errSerializer = (opts.log.serializers && opts.log.serializers.err)
        ? opts.log.serializers.err : bunyan.stdSerializers.err;
    var log = opts.log.child({
        audit: true,
        serializers: {
            err: errSerializer,
            req: function auditReqSerializer(req) {
                if (!req) {
                    return false;
                }

                var routeOpts = routeOptsFromRoute(req.route);

                var timers = {};
                (req.timers || []).forEach(function (time) {
                    var t = time.time;
                    var _t = Math.floor((1000000 * t[0]) + (t[1] / 1000));
                    // TODO: restify 6.x diff here to consider
                    timers[time.name] = _t;
                });

                return {
                    body: auditBodyFromReq(req, routeOpts.reqBody),
                    // TODO: consider connectionState from restify 6.x here
                    headers: req.headers,
                    httpVersion: req.httpVersion,
                    method: req.method,
                    // account for native and queryParser plugin usage
                    query: (typeof (req.query) === 'function') ?
                        req.query() : req.query,
                    timers: timers,
                    trailers: req.trailers,
                    url: req.url,
                    version: req.version()
                };
            },
            res: function auditResSerializer(res) {
                if (!res) {
                    return false;
                }

                var routeOpts = routeOptsFromRoute(res.req.route);

                return {
                    body: auditBodyFromRes(res, routeOpts.resBody),
                    headers: getResponseHeaders(res),
                    statusCode: res.statusCode,
                    trailer: res._trailer || false
                };
            }
        }
    });

    function audit(req, res, route, err) {
        var routeName = route && route.name || undefined;
        var routeOpts = routeOptsFromRoute(route);

        if (!routeOpts.include) {
            return;
        }

        // TODO: 6.x diff here to accomodate.
        var latency = res.get('Response-Time');
        if (typeof (latency) !== 'number') {
            latency = Date.now() - req._time;
        }

        var fields = {
            err: err,
            latency: latency,
            remoteAddress: req.connection.remoteAddress,
            remotePort: req.connection.remotePort,
            req: req,
            req_id: req.getId(),
            res: res,
            route: routeName,
            secure: req.secure
        };

        if (routeOpts.polish) {
            routeOpts.polish(fields, req, res, route, err);
        }

        log[routeOpts.logFnName](fields, 'handled: %d', res.statusCode);
    }

    return audit;
}


// ---- exports

module.exports = {
    createAuditLogHandler: createAuditLogHandler
};
