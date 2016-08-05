<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2016, Joyent, Inc.
-->

# sdc-sapi

This repository is part of the Joyent Triton project. See the [contribution
guidelines](https://github.com/joyent/triton/blob/master/CONTRIBUTING.md) --
*Triton does not use GitHub PRs* -- and general documentation at the main
[Triton project](https://github.com/joyent/triton) page.

SAPI is the Services API.  This API allows operators to configure, deploy, and
upgrade software using a set of loosely-coupled federated services.

# Repository

    bin/            Commands available in $PATH.
    boot/           Configuration scripts on zone setup.
    cmd/            Top-level commands.
    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    etc/            Test configuration files for running SAPI locally
    lib/            Source files.
    node_modules/   Node.js dependencies
    sapi_manifests/ SAPI manifests for zone configuration.
    smf/manifests   SMF manifests
    test/           Test suite (using nodeunit)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    Makefile
    package.json    npm module info (holds the project version)
    README.md


# Development

To run a SAPI server locally:

    git clone git@github.com:joyent/sdc-sapi.git
    cd sapi
    git submodule update --init
    make all
    node server.js

Before commiting/pushing run `make prepush` and, if warranted, get a code
review.


# Testing

To test, SSH to your test machine and run:

    # sdc-login sapi
    # /opt/smartdc/sapi/tests/runtests

The full test suite takes approximately 8-10 minutes to run.  It also requires
that both the IMGAPI and SAPI zones have external NICs, to communicate with
updates.joyent.com.  Run this on the headnode for each that doesn't already
have an external nic:

    /usbkey/scripts/add_external_nic.sh $(vmadm lookup -1 alias=~sapi)
    /usbkey/scripts/add_external_nic.sh $(vmadm lookup -1 alias=~imgapi)

To run a single test (for example):

    TEST_SAPI_PROTO_MODE=false ./node_modules/.bin/nodeunit \
        ./test/mode.test.js -t 'upgrade to full mode'

When running tests, the SAPI SMF service will be disabled so the server logs
will be rewritten by nodeunit on a separate file located at:

    /opt/smartdc/sapi/test/tests.log
