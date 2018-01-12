#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2018, Joyent, Inc.
#

#
# Makefile: builds Services API
#

#
# Tools
#
NODEUNIT	:= ./node_modules/.bin/nodeunit

#
# Files
#
DOC_FILES	 = index.md
RESTDOWN_FLAGS   = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS += deps/restdown-brand-remora/.git
JS_FILES	:= $(shell ls *.js) $(shell find lib test tools -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,doxygen,unparenthesized-return=0
SMF_MANIFESTS	 = smf/manifests/sapi.xml

NODE_PREBUILT_VERSION=v4.9.0
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_TAG=zone
	# The sdcnode matching image for triton-origin-multiarch-15.4.1 images.
	NODE_PREBUILT_IMAGE=18b094b0-eb01-11e5-80c1-175dac7ddf02
endif


include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	NPM := $(shell which npm)
	NPM_EXEC=$(NPM)
endif
include ./tools/mk/Makefile.smf.defs


#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NODEUNIT) $(REPO_DEPS) sdc-scripts
	$(NPM) install

$(NODEUNIT): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += ./node_modules


#
# Packaging targets
#

TOP             := $(shell pwd)

SVC_TARBALL 	:= sapi-pkg-$(STAMP).tar.bz2
SVC_PKGDIR	:= $(TOP)/$(BUILD)/service
SVC_INSTDIR	:= $(SVC_PKGDIR)/root/opt/smartdc/sapi

.PHONY: release
release: $(SVC_TARBALL)

.PHONY: service
service: all $(SMF_MANIFESTS)
	@echo "Building $(SVC_TARBALL)"
	@rm -rf $(SVC_PKGDIR)
	@mkdir -p $(SVC_PKGDIR)/site
	@mkdir -p $(SVC_INSTDIR)/build
	@mkdir -p $(SVC_INSTDIR)/smf/manifests
	@mkdir -p $(SVC_INSTDIR)/test
	@mkdir -p $(SVC_INSTDIR)/tools
	@touch $(SVC_PKGDIR)/site/.do-not-delete-me
	cp -r $(TOP)/server.js \
		$(TOP)/lib \
		$(TOP)/node_modules \
		$(TOP)/package.json \
		$(SVC_INSTDIR)/
	cp -r $(TOP)/lib/common \
		$(TOP)/lib/server \
		$(SVC_INSTDIR)/lib
	mkdir -p $(TOP)/build/service/root/opt/smartdc/boot
	cp -R $(TOP)/deps/sdc-scripts/* \
	    $(TOP)/build/service/root/opt/smartdc/boot/
	cp -R $(TOP)/boot/* \
	    $(TOP)/build/service/root/opt/smartdc/boot/
	cp -P smf/manifests/sapi.xml $(SVC_INSTDIR)/smf/manifests
	cp -r $(TOP)/sapi_manifests $(SVC_INSTDIR)/
	cp -r $(TOP)/test $(SVC_INSTDIR)/
	cp -PR $(NODE_INSTALL) $(SVC_INSTDIR)/build/node


$(SVC_TARBALL): service
	(cd $(SVC_PKGDIR) && $(TAR) -jcf $(TOP)/$(SVC_TARBALL) root site)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
    echo "error: 'BITS_DIR' must be set for 'publish' target"; \
    exit 1; \
  fi
	mkdir -p $(BITS_DIR)/sapi
	cp $(TOP)/$(SVC_TARBALL) $(BITS_DIR)/sapi/$(SVC_TARBALL)

include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
