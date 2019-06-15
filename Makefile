#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2019, Joyent, Inc.
#

#
# Makefile: builds Services API
#

NAME = sapi

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

NODE_PREBUILT_VERSION=v6.17.0
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_TAG=zone64
	NODE_PREBUILT_IMAGE=c2c31b00-1d60-11e9-9a77-ff9f06554b0f
endif

ENGBLD_USE_BUILDIMAGE	= true
ENGBLD_REQUIRE		:= $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
else
	NPM := $(shell which npm)
	NPM_EXEC=$(NPM)
endif
include ./deps/eng/tools/mk/Makefile.smf.defs


#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NODEUNIT) sdc-scripts
	$(NPM) install

$(NODEUNIT): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += ./node_modules

#
# Packaging targets
#
SVC_TARBALL 	:= $(NAME)-pkg-$(STAMP).tar.gz
SVC_PKGDIR	:= $(TOP)/$(BUILD)/service
SVC_INSTDIR	:= $(SVC_PKGDIR)/root/opt/smartdc/sapi

# our base image is triton-origin-x86_64-18.4.0
BASE_IMAGE_UUID = a9368831-958e-432d-a031-f8ce6768d190
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= SDC SAPI
BUILDIMAGE_PKG	= $(PWD)/$(SVC_TARBALL)
AGENTS		= amon config registrar

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
	cp smf/manifests/sapi.xml $(SVC_INSTDIR)/smf/manifests
	cp -r $(TOP)/sapi_manifests $(SVC_INSTDIR)/
	cp -r $(TOP)/test $(SVC_INSTDIR)/
	cp -PR $(NODE_INSTALL) $(SVC_INSTDIR)/build/node


$(SVC_TARBALL): service
	(cd $(SVC_PKGDIR) && $(TAR) -I pigz -cf $(TOP)/$(SVC_TARBALL) root site)

.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/sapi
	cp $(TOP)/$(SVC_TARBALL) $(ENGBLD_BITS_DIR)/sapi/$(SVC_TARBALL)

include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
