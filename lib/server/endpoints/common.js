/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Handlers shared by several end-points
 */
var restify = require('restify');

function ensureMasterConfigLoaded(req, res, next) {
    var model = this.model;

    if (req.params.include_master) {
        if (typeof (model.config.moray.master_host) === 'undefined') {
            next(new restify.ServiceUnavailableError(
                'Parameter \'include_master\' has been specified but ' +
                'this SAPI instance has not yet loaded master details'));
            return;
        }
        if (model.config.moray.master_host !== '' &&
            model.config.moray.master_host !== null) {
            req.include_master = true;
        }
    }
    next();
}

module.exports = {
    ensureMasterConfigLoaded: ensureMasterConfigLoaded
};
