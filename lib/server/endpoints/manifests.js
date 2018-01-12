/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * lib/server/endpoints/manifests.js: SAPI endpoints to manage configuration
 *     manifests
 */

var restify = require('restify');
var semver = require('semver');
var verror = require('verror');

var validateParams =
    require('./validation').validateParams;
var common = require('./common');

function Manifests() {}

var MANIFEST_KEYS = ['name', 'path', 'template'];

Manifests.create = function (req, res, next) {
    var model = this.model;
    var log = model.log;

    var params = {};
    params.uuid = req.params.uuid;

    params.name = req.params.name;
    params.path = req.params.path;
    params.template = req.params.template;
    params.post_cmd = req.params.post_cmd;
    params.version = req.params.version;

    params.master = req.params.master;

    var valError = validateParams(
        { keys: MANIFEST_KEYS,
          params: params });
    if (valError) {
        next(valError);
        return;
    }

    if (params.version && !semver.valid(params.version)) {
        log.error({ version: params.version }, 'invalid version');
        next(new restify.InvalidArgumentError('invalid version'));
        return;
    }

    model.createManifest(params, function (err, mfest) {
        if (err) {
            model.log.error(err, 'failed to create manifest');
            next(err);
            return;
        }

        res.send(mfest);
        next();
    });

};

Manifests.list = function (req, res, next) {
    var model = this.model;

    var opts = {};
    if (req.include_master) {
        opts.include_master = true;
    }

    model.listManifests(opts, function (err, mfests) {
        if (err) {
            model.log.error(err, 'failed to list manifests');
            next(err);
            return;
        }

        res.send(mfests);
        next();
    });
};

Manifests.get = function (req, res, next) {
    var model = this.model;

    model.getManifest(req.params.uuid, function (err, mfest) {
        if (err) {
            next(err);
            return;
        }

        res.send(mfest);
        next();
    });
};

Manifests.del = function (req, res, next) {
    var model = this.model;

    model.delManifest(req.params.uuid, function (err) {
        if (err && verror.hasCauseWithName(err, 'ObjectNotFoundError')) {
            res.send(404);
            next();
            return;
        } else if (err) {
            model.log.error(err, 'failed to delete manifest');
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

    // Create a manifest
    sapi.post({ path: '/manifests', name: 'CreateManifest' },
        Manifests.create.bind(toModel));

    // List all manifests
    sapi.get({ path: '/manifests', name: 'ListManifests' },
        common.ensureMasterConfigLoaded.bind(toModel),
        Manifests.list.bind(toModel));

    // Get a manifest
    sapi.get({ path: '/manifests/:uuid', name: 'GetManifest' },
        Manifests.get.bind(toModel));

    // Delete a manifest
    sapi.del({ path: '/manifests/:uuid', name: 'DeleteManifest' },
        Manifests.del.bind(toModel));
}

exports.attachTo = attachTo;
