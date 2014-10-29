/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/common/util.js: utility functions
 */

var assert = require('assert-plus');
var semver = require('semver');

var exec = require('child_process').exec;


// -- Exported interface

module.exports.zonename = zonename;
module.exports.semverGter = semverGter;

/*
 * Return the current zone name.
 */
function zonename(cb) {
    assert.func(cb, 'cb');

    exec('/usr/bin/zonename', function (err, stdout) {
        if (err)
            return (cb(new Error(err.message)));

        return (cb(null, stdout.trim()));
    });
}


/*
 * Is the given semver range (e.g. from Accept-Version header)
 * greater than or equal to the given `ver` (e.g. a set starting version
 * for an IMGAPI feature).
 */
function semverGter(range, ver) {
    return (range === '*' || // quick out
        semver.satisfies(ver, range) ||
        semver.ltr(ver, range));
}
