/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/endpoints/services.js: SAPI endpoints to manage services
 */

var assert = require('assert-plus');
var restify = require('restify');

var semverGter = require('../../common/util').semverGter;

function Services() {}

function isValidService(svc) {
    var valid = true;

    if (!svc)
        return (false);

    valid = valid && svc.name;
    valid = valid && svc.application_uuid;

    return (valid);
}

/*
 * accept-version aware service object representation. Make sure to include any
 * API versioning logic here. obj represents the basic (version ~1) service
 */
function serialize(svc, version) {
    var obj = {
        uuid: svc.uuid,
        name: svc.name,
        application_uuid: svc.application_uuid,
        params: svc.params,
        metadata: svc.metadata,
        manifests: svc.manifests,
        master: svc.master
    };

    if (semverGter(version, '2.0.0')) {
        obj.type = svc.type;
    }

    return (obj);
}

/*
 * accept-version aware filter construction. This is so we can choose to exclude
 * some service objects (like type=agent) from the response when they would not
 * be understood by legacy API clients.
 */
function addVersionFilters(filters, version) {
    // New API clients, only vm services
    if (!semverGter(version, '2.0.0')) {
        filters.type = 'vm';
    }
}


Services.create = function (req, res, next) {
    var model = this.model;
    var log = model.log;

    var params = {};
    params.uuid = req.params.uuid;

    params.name = req.params.name;
    params.application_uuid = req.params.application_uuid;

    params.params = req.params.params;
    params.metadata = req.params.metadata;
    params.manifests = req.params.manifests;

    params.master = req.params.master;
    params.type = req.params.type;

    if (!isValidService(params)) {
        log.error({ params: params }, 'missing required parameters');
        return (next(new restify.MissingParameterError()));
    }

    model.createService(params, function (err, svc) {
        if (err) {
            model.log.error(err, 'failed to create service');
            return (next(err));
        }

        res.send(serialize(svc, req.getVersion()));
        return (next());
    });

    return (null);
};

Services.list = function (req, res, next) {
    var model = this.model;

    var filters = {};
    addVersionFilters(filters, req.getVersion());

    if (req.params.name)
        filters.name = req.params.name;
    if (req.params.application_uuid)
        filters.application_uuid = req.params.application_uuid;
    if (req.params.type)
        filters.type = req.params.type;

    var opts = {};
    if (req.params.include_master)
        opts.include_master = true;

    model.listServices(filters, opts, function (err, svcs) {
        if (err) {
            model.log.error(err, 'failed to list services');
            return (next(err));
        }

        var acceptVersion = req.getVersion();
        res.send(svcs.map(function (svc) {
            return (serialize(svc, acceptVersion));
        }));

        return (next());
    });
};

Services.get = function (req, res, next) {
    var model = this.model;

    model.getService(req.params.uuid, function (err, svc) {
        if (err)
            return (next(err));

        res.send(serialize(svc, req.getVersion()));
        return (next());
    });
};

Services.update = function (req, res, next) {
    var model = this.model;

    var uuid = req.params.uuid;

    var changes = {};
    changes.params = req.params.params;
    changes.metadata = req.params.metadata;
    changes.manifests = req.params.manifests;

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
        return (next(new restify.InvalidArgumentError()));
    }

    model.updateService(uuid, changes, action, function (err, svc) {
        if (err) {
            model.log.error(err, 'failed to update service');
            return (next(err));
        }

        res.send(serialize(svc, req.getVersion()));
        return (next());
    });

    return (null);
};

Services.del = function (req, res, next) {
    var model = this.model;

    model.delService(req.params.uuid, function (err) {
        if (err && err.name === 'ObjectNotFoundError') {
            res.send(404);
            return (next());
        } else if (err) {
            model.log.error(err, 'failed to delete service');
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

    // Create a service
    sapi.post({ path: '/services', name: 'CreateService' },
        Services.create.bind(toModel));

    // List all services
    sapi.get({ path: '/services', name: 'ListServices' },
        Services.list.bind(toModel));

    // Get a service
    sapi.get({ path: '/services/:uuid', name: 'GetService' },
        Services.get.bind(toModel));

    // Update a service
    sapi.put({ path: '/services/:uuid', name: 'UpdateService' },
        Services.update.bind(toModel));

    // Delete a service
    sapi.del({ path: '/services/:uuid', name: 'DeleteService' },
        Services.del.bind(toModel));
}

exports.attachTo = attachTo;
