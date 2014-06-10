# Services API (SAPI)

Repository: <git@git.joyent.com:sapi.git>
Browsing: <https://mo.joyent.com/sapi>
Who: Bill Pijewski
Docs: <https://mo.joyent.com/docs/sapi/master>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/SAPI>


# Overview

See <https://mo.joyent.com/docs/sapi/master/#overview>.


# Repository

    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    etc/            Test configuration files for running SAPI locally
    lib/            Source files.
    node_modules/   Node.js dependencies
    smf/manifests   SMF manifests
    smf/methods     SMF method scripts
    test/           Test suite (using nodeunit)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    Makefile
    package.json    npm module info (holds the project version)
    README.md


# Development

To run a SAPI server locally:

    git clone git@git.joyent.com:sapi.git
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
