/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * lib/endpoints/history.js: SAPI endpoints to manage history of changes
 */

var util = require('util');
var restify = require('restify');
var verror = require('verror');

var validateParams =
    require('./validation').validateParams;

function History() {}

var HISTORY_KEYS = ['started', 'changes', 'uuid'];

History.create = function (req, res, next) {
    var model = this.model;

    var params = {};
    params.uuid = req.params.uuid;

    params.started = req.params.started;
    params.changes = req.params.changes;

    params.params = req.params.params;


    var valError = validateParams(
        { keys: HISTORY_KEYS,
          params: params });
    if (valError) {
        next(valError);
        return;
    }

    model.createHistory(params, function (err, app) {
        if (err) {
            model.log.error(err, 'failed to create history item');
            return (next(err));
        }

        res.send(app);
        return (next());
    });

    return (null);
};

History.list = function (req, res, next) {
    var model = this.model;

    var filters = {};
    if (req.params.since) {
        try {
            filters.since = new Date(req.params.since).getTime();
        } catch (e) {
            var msg = util.format('Invalid param \'since\': %s',
                    req.params.since);
            model.log.debug(msg);
            return (next(new restify.InvalidArgumentError(msg)));
        }
    }

    if (req.params.until) {
        try {
            filters.until = new Date(req.params.until).getTime();
        } catch (e2) {
            var m2 = util.format('Invalid param \'until\': %s',
                    req.params.until);
            model.log.debug(m2);
            return (next(new restify.InvalidArgumentError(m2)));
        }
    }

    var opts = {};


    model.listHistory(filters, opts, function (err, apps) {
        if (err) {
            model.log.error(err, 'failed to list history');
            return (next(err));
        }

        res.send(apps);
        return (next());
    });
};

History.get = function (req, res, next) {
    var model = this.model;

    model.getHistory(req.params.uuid, function (err, app) {
        if (err) {
            return (next(err));
        }
        res.send(app);
        return (next());
    });
};

History.update = function (req, res, next) {
    var model = this.model;

    var uuid = req.params.uuid;

    var changes = req.params;

    model.updateHistory(uuid, changes, 'set', function (err, app) {
        if (err) {
            model.log.error(err, 'failed to update history item');
            return (next(err));
        }

        res.send(app);
        return (next());
    });

    return (null);
};

History.del = function (req, res, next) {
    var model = this.model;

    model.delHistory(req.params.uuid, function (err) {
        if (err && verror.hasCauseWithName(err, 'ObjectNotFoundError')) {
            res.send(404);
            next();
            return;
        } else if (err) {
            model.log.error(err, 'failed to delete history item');
            next(err);
            return;
        }

        res.send(204);
        next();
    });
};


function attachTo(sapi, model) {
    var toModel = {
        model: model
    };

    // Create history record
    sapi.post({
        path: '/history',
        name: 'CreateHistory',
        version: ['2.0.0']
    }, History.create.bind(toModel));

    // List all the history records
    sapi.get({
        path: '/history',
        name: 'ListHistory',
        version: ['2.0.0']
    }, History.list.bind(toModel));

    // Get single history record
    sapi.get({
        path: '/history/:uuid',
        name: 'GetHistory',
        version: ['2.0.0']
    }, History.get.bind(toModel));

    // Update history record
    sapi.put({
        path: '/history/:uuid',
        name: 'UpdateHistory',
        version: ['2.0.0']
    }, History.update.bind(toModel));

    // Delete history record
    sapi.del({
        path: '/history/:uuid',
        name: 'DeleteHistory',
        version: ['2.0.0']
    }, History.del.bind(toModel));
}

exports.attachTo = attachTo;
