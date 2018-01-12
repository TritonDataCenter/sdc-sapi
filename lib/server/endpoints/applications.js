/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * lib/endpoints/applications.js: SAPI endpoints to manage applications
 */

var restify = require('restify');
var verror = require('verror');

var validateParams =
    require('./validation').validateParams;
var common = require('./common');

function Applications() {}

var APPLICATION_KEYS = ['name', 'owner_uuid'];

Applications.create = function (req, res, next) {
    var model = this.model;

    var params = {};
    params.uuid = req.params.uuid;

    params.name = req.params.name;
    params.owner_uuid = req.params.owner_uuid;

    params.params = req.params.params;
    params.metadata = req.params.metadata;
    params.metadata_schema = req.params.metadata_schema;
    params.manifests = req.params.manifests;

    params.master = req.params.master;

    var valError = validateParams(
        { keys: APPLICATION_KEYS,
          params: params });
    if (valError) {
        next(valError);
        return;
    }

    model.createApplication(params, function (err, app) {
        if (err) {
            model.log.error(err, 'failed to create application');
            next(err);
            return;
        }

        res.send(app);
        next();
        return;
    });
};

Applications.list = function (req, res, next) {
    var model = this.model;

    var filters = {};
    if (req.params.name)
        filters.name = req.params.name;
    if (req.params.owner_uuid)
        filters.owner_uuid = req.params.owner_uuid;

    var opts = {};
    if (req.include_master) {
        opts.include_master = true;
    }

    model.listApplications(filters, opts, function (err, apps) {
        if (err) {
            model.log.error(err, 'failed to list applications');
            next(err);
            return;
        }

        res.send(apps);
        next();
    });
};

Applications.get = function (req, res, next) {
    var model = this.model;

    model.getApplication(req.params.uuid, function (err, app) {
        if (err) {
            next(err);
            return;
        }
        res.send(app);
        next();
    });
};

Applications.update = function (req, res, next) {
    var model = this.model;

    var uuid = req.params.uuid;

    var changes = {};
    changes.params = req.params.params;
    changes.metadata = req.params.metadata;
    changes.metadata_schema = req.params.metadata_schema;
    changes.manifests = req.params.manifests;
    changes.owner_uuid = req.params.owner_uuid;

    /*
     * If not specified, the default action is to update existing
     * attributes.
     */
    if (!req.params.action)
        req.params.action = 'update';

    var action = req.params.action.toLowerCase();

    if (action !== 'update' &&
        action !== 'replace' &&
        action !== 'delete') {
        model.log.error({ action: action }, 'invalid action');
        next(new restify.InvalidArgumentError());
        return;
    }

    model.updateApplication(uuid, changes, action, function (err, app) {
        if (err) {
            model.log.error(err, 'failed to update application');
            next(err);
            return;
        }

        res.send(app);
        next();
    });
};

Applications.del = function (req, res, next) {
    var model = this.model;

    model.delApplication(req.params.uuid, function (err) {
        if (err && verror.hasCauseWithName(err, 'ObjectNotFoundError')) {
            res.send(404);
            next();
            return;
        } else if (err) {
            model.log.error(err, 'failed to delete application');
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

    // Create an application
    sapi.post({ path: '/applications', name: 'CreateApplication' },
        Applications.create.bind(toModel));

    // List all applications
    sapi.get({ path: '/applications', name: 'ListApplications' },
        common.ensureMasterConfigLoaded.bind(toModel),
        Applications.list.bind(toModel));

    // Get an application
    sapi.get({ path: '/applications/:uuid', name: 'GetApplication' },
        Applications.get.bind(toModel));

    // Update an application
    sapi.put({ path: '/applications/:uuid', name: 'UpdateApplication' },
        Applications.update.bind(toModel));

    // Delete an application
    sapi.del({ path: '/applications/:uuid', name: 'DeleteApplication' },
        Applications.del.bind(toModel));
}

exports.attachTo = attachTo;
