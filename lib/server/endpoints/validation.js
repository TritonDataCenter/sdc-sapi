/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/server/endpoints/validation.js: SAPI endpoint paramter validation
 */

var assert = require('assert-plus');
var restify = require('restify');


function validateParams(opts) {
    var keys = opts.keys;
    var params = opts.params;

    assert.arrayOfString(keys, 'opts.keys');
    assert.object(params, 'opts.params');

    var missing = keys.filter(function (k) {
        return (!params.hasOwnProperty(k) ||
                  typeof (params[k]) === 'undefined');
    });

    if (missing.length) {
        return new restify.MissingParameterError(
            'missing required keys: %s', missing.join(', '));
    }
}

module.exports = {
    validateParams: validateParams
};
