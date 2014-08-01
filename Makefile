#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
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
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell ls *.js) $(shell find cmd lib test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o doxygen
SMF_MANIFESTS_IN = smf/manifests/sapi.xml.in

NODE_PREBUILT_VERSION=v0.10.26
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_TAG=zone
	# Allow building on a SmartOS image other than sdc-smartos/1.6.3.
	NODE_PREBUILT_IMAGE=fd2cc906-8938-11e3-beab-4359c665ac99
endif


include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	include ./tools/mk/Makefile.node.defs
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

CLEAN_FILES += $(NODEUNIT) ./node_modules/tap ./test/tests.log

#
# Test SAPI in both modes: proto and full
#
.PHONY: test
test: $(NODEUNIT)
	MODE=proto $(NODEUNIT) test/*.test.js
	MODE=full $(NODEUNIT) test/*.test.js


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
	@mkdir -p $(SVC_INSTDIR)/lib
	@mkdir -p $(SVC_INSTDIR)/smf/manifests
	@mkdir -p $(SVC_INSTDIR)/test
	@mkdir -p $(SVC_INSTDIR)/tools
	@touch $(SVC_PKGDIR)/site/.do-not-delete-me
	cp -r $(TOP)/server.js \
		$(TOP)/node_modules \
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
else
	include ./tools/mk/Makefile.node.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
