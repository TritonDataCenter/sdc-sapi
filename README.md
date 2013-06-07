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

To test:

    make prepush

The full test suite takes approximately 10 minutes to run.

The test suite's configuration (test/etc/config.kvm6.json) defaults to SDC
endpoints on bh1-kvm6.  If you're testing SAPI against a different machine,
you'll need to update those parameters accordingly.

Since gateways on the admin network are no longer added by default, you may need
to use the usb-headnode.git/devtools/add-admin-gateway.sh script to add those
gateways.  In addition, some zones may have firewall rules which prevent those
zones from being reached from a development zone, so you may also need to
disable those firewalls ("fmadm stop <uuid>").

Eventually the SAPI test suite should be shipped alongside SAPI itself to allow
in-situ testing of SAPI.  That improvement will greatly reduce the amount of
configuration necessary for a test environment.
