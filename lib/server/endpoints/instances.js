/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * lib/server/endpoints/instances.js: SAPI endpoints to manage instances
 */

var restify = require('restify');
var verror = require('verror');

var semverGter = require('../../common/util').semverGter;
var validateParams =
    require('./validation').validateParams;
var common = require('./common');

function Instances() {}

var INSTANCE_KEYS = ['service_uuid'];


/*
 * accept-version aware instance object representation. Make sure to include any
 * API versioning logic here. obj represents the basic (version ~1) instance
 */
function serialize(instance, version) {
    var obj = {
        uuid: instance.uuid,
        service_uuid: instance.service_uuid,
        params: instance.params,
        metadata: instance.metadata,
        manifests: instance.manifests,
        master: instance.master
    };

    if (instance.job_uuid) {
        obj.job_uuid = instance.job_uuid;
    }

    if (semverGter(version, '2.0.0')) {
        obj.type = instance.type;
    }

    if (instance.server_uuid && !obj.params.server_uuid) {
        obj.params.server_uuid = instance.server_uuid;
    }

    return (obj);
}

/*
 * accept-version aware filter construction. This is so we can choose to exclude
 * some instance objects (like type=agent) from the response when they would not
 * be understood by legacy API clients.
 */
function addVersionFilters(filters, version) {
    // New API clients, only vm instances
    if (!semverGter(version, '2.0.0')) {
        filters.type = 'vm';
    }
}

Instances.create = function (req, res, next) {
    var doAsync = req.params.async || false;
    var model = this.model;
    var log = model.log;

    /*
     * Node's default HTTP timeout is two minutes, and this CreateInstance
     * request can take longer than that to complete.  Set this connection's
     * timeout to an hour to avoid an abrupt close after two minutes.
     *
     * It can take this long since the provisioner agent downloads and
     * installed the image from the datacenter's local IMGAPI, and if that
     * image is compressed with bzip2, it takes roughly six minutes to
     * decompress 1 GB of that image.
     */
    if (!doAsync) {
        req.connection.setTimeout(60 * 60 * 1000);
    }

    log.debug({ 'req.params': req.params }, 'creating instance');

    var params = {};
    params.async = doAsync;
    params.uuid = req.params.uuid;

    params.service_uuid = req.params.service_uuid;

    if (req.params.params && req.params.params.server_uuid) {
        params.server_uuid = req.params.params.server_uuid;
    }

    params.params = req.params.params;
    params.metadata = req.params.metadata;
    params.manifests = req.params.manifests;

    params.master = req.params.master;

    var valError = validateParams(
        { keys: INSTANCE_KEYS,
          params: params });
    if (valError) {
        next(valError);
        return;
    }

    model.createInstance(params, function (err, inst) {
        if (err) {
            log.error(err, 'failed to create instance');
            return (next(err));
        }

        res.send(serialize(inst, req.getVersion()));
        return (next());
    });
};


Instances.list = function (req, res, next) {
    var model = this.model;

    var filters = {};
    addVersionFilters(filters, req.getVersion());

    // If service_uuid is passed then service.type is implied
    if (req.params.service_uuid) {
        delete filters.type;
        filters.service_uuid = req.params.service_uuid;
    } else if (req.params.type) {
        filters.type = req.params.type;
    } else if (req.params.server_uuid) {
        filters.server_uuid = req.params.server_uuid;
    }

    var opts = {};

    if (req.include_master) {
        opts.include_master = true;
    }

    model.listInstances(filters, opts, function (err, insts) {
        if (err) {
            model.log.error(err, 'failed to list instances');
            next(err);
            return;
        }

        var acceptVersion = req.getVersion();
        res.send(insts.map(function (inst) {
            return (serialize(inst, acceptVersion));
        }));
        next();
    });
};

Instances.get = function (req, res, next) {
    var model = this.model;

    model.getInstance(req.params.uuid, function (err, inst) {
        if (err)
            return (next(err));

        res.send(serialize(inst, req.getVersion()));
        return (next());
    });
};

Instances.getPayload = function (req, res, next) {
    var model = this.model;

    model.getInstancePayload(req.params.uuid, function (err, params) {
        if (err) {
            model.log.error(err, 'failed to get instance payload');
            return (next(err));
        } else if (!params) {
            res.send(404);
        } else {
            res.send(params);
        }

        return (next());
    });
};

Instances.update = function (req, res, next) {
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

    model.updateInstance(uuid, changes, action, function (err, inst) {
        if (err) {
            model.log.error(err, 'failed to update instance');
            return (next(err));
        }

        res.send(serialize(inst, req.getVersion()));
        return (next());
    });

    return (null);
};

Instances.upgrade = function (req, res, next) {
    var model = this.model;

    var uuid = req.params.uuid;
    var image_uuid = req.params.image_uuid;

    if (!image_uuid) {
        next(new restify.MissingParameterError('missing image_uuid'));
        return;
    }

    model.upgradeInstance(uuid, image_uuid, function (err, inst) {
        if (err) {
            model.log.error(err, 'failed to upgrade instance');
            next(err);
            return;
        }

        res.send(serialize(inst, req.getVersion()));
        next();
    });
};

Instances.del = function (req, res, next) {
    var model = this.model;

    /*
     * As with CreateInstance above, a DeleteInstance call may take longer
     * than two minutes, so increase this connection's timeout to avoid an
     * abrupt close.
     *
     * Deleting an instance _should_ be relatively quick, so bump the
     * timeout to 10 minutes instead of the 60 for CreateInstance.
     */
    req.connection.setTimeout(10 * 60 * 1000);

    model.delInstance(req.params.uuid, function (err) {
        if (err && verror.hasCauseWithName(err, 'ObjectNotFoundError')) {
            res.send(404);
            next();
            return;
        } else if (err) {
            model.log.error(err, 'failed to delete instance');
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

    // Create an instance
    sapi.post({ path: '/instances', name: 'CreateInstance' },
        Instances.create.bind(toModel));

    // List all instances
    sapi.get({ path: '/instances', name: 'ListInstances' },
        common.ensureMasterConfigLoaded.bind(toModel),
        Instances.list.bind(toModel));

    // Get an instance
    sapi.get({ path: '/instances/:uuid', name: 'GetInstance' },
        Instances.get.bind(toModel));

    // Get an instance's payload
    sapi.get({
        path: '/instances/:uuid/payload',
        name: 'GetInstancePayload'
    }, Instances.getPayload.bind(toModel));

    // Update an instance
    sapi.put({ path: '/instances/:uuid', name: 'UpdateInstance' },
        Instances.update.bind(toModel));

    // Upgrade an instance
    sapi.put({
        path: '/instances/:uuid/upgrade',
        name: 'UpgradeInstance' },
    Instances.upgrade.bind(toModel));

    // Delete an instance
    sapi.del({ path: '/instances/:uuid', name: 'DeleteInstance' },
        Instances.del.bind(toModel));
}

exports.attachTo = attachTo;
