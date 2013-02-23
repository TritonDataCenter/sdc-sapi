#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
#
# Makefile: builds Services API and associated config-agent
#

#
# Tools
#
NODEUNIT	:= ./node_modules/.bin/nodeunit

#
# Files
#
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell ls *.js) $(shell find lib test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o doxygen
SMF_MANIFESTS_IN = smf/manifests/sapi.xml.in smf/manifests/config-agent.xml.in

NODE_PREBUILT_VERSION=v0.8.20
NODE_PREBUILT_TAG=zone


include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.node_prebuilt.defs
include ./tools/mk/Makefile.node_deps.defs
include ./tools/mk/Makefile.smf.defs


#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NODEUNIT) $(REPO_DEPS)
	$(NPM) rebuild

$(NODEUNIT): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += $(NODEUNIT) ./node_modules/tap

.PHONY: test
test: $(NODEUNIT)
	$(NODEUNIT) test/*.test.js


#
# Packaging targets
#

TOP             := $(shell pwd)

SVC_TARBALL 	:= sapi-pkg-$(STAMP).tar.bz2
SVC_PKGDIR	:= $(TOP)/$(BUILD)/service
SVC_INSTDIR	:= $(SVC_PKGDIR)/root/opt/smartdc/sapi

AGENT_TARBALL 	:= config-agent-$(STAMP).tar.bz2
AGENT_PKGDIR	:= $(TOP)/$(BUILD)/agent
AGENT_INSTDIR	:= $(AGENT_PKGDIR)/root/opt/smartdc/config-agent

.PHONY: release
release: $(SVC_TARBALL) $(AGENT_TARBALL)

.PHONY: service
service: all $(SMF_MANIFESTS)
	@echo "Building $(SVC_TARBALL)"
	@rm -rf $(SVC_PKGDIR)
	@mkdir -p $(SVC_PKGDIR)/site
	@mkdir -p $(SVC_INSTDIR)/build
	@mkdir -p $(SVC_INSTDIR)/lib
	@mkdir -p $(SVC_INSTDIR)/smf/manifests
	@mkdir -p $(SVC_INSTDIR)/test
	@touch $(SVC_PKGDIR)/site/.do-not-delete-me
	cp -r $(TOP)/server.js \
		$(TOP)/node_modules \
		$(SVC_INSTDIR)/
	cp -r $(TOP)/lib/common \
		$(TOP)/lib/server \
		$(SVC_INSTDIR)/lib
	cp -P smf/manifests/sapi.xml $(SVC_INSTDIR)/smf/manifests
	cp -r $(TOP)/test $(SVC_INSTDIR)/
	cp -PR $(NODE_INSTALL) $(SVC_INSTDIR)/build/node

$(SVC_TARBALL): service
	(cd $(SVC_PKGDIR) && $(TAR) -jcf $(TOP)/$(SVC_TARBALL) root site)

.PHONY: agent
agent: all $(SMF_MANIFESTS)
	@echo "Building $(AGENT_TARBALL)"
	@rm -rf $(AGENT_PKGDIR)
	@mkdir -p $(AGENT_PKGDIR)/site
	@mkdir -p $(AGENT_INSTDIR)/build
	@mkdir -p $(AGENT_INSTDIR)/lib
	@mkdir -p $(AGENT_INSTDIR)/smf/manifests
	@mkdir -p $(AGENT_INSTDIR)/test
	@touch $(AGENT_PKGDIR)/site/.do-not-delete-me
	cp -r $(TOP)/agent.js \
		$(TOP)/node_modules \
		$(AGENT_INSTDIR)
	cp -r $(TOP)/lib/common \
		$(TOP)/lib/agent \
		$(AGENT_INSTDIR)/lib
	cp -P smf/manifests/config-agent.xml $(AGENT_INSTDIR)/smf/manifests
	cp -r $(TOP)/test $(AGENT_INSTDIR)/
	cp -PR $(NODE_INSTALL) $(AGENT_INSTDIR)/build/node

$(AGENT_TARBALL): agent
	(cd $(AGENT_PKGDIR) && $(TAR) -jcf $(TOP)/$(AGENT_TARBALL) root site)


.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
    echo "error: 'BITS_DIR' must be set for 'publish' target"; \
    exit 1; \
  fi
	mkdir -p $(BITS_DIR)/sapi
	cp $(TOP)/$(SVC_TARBALL) $(BITS_DIR)/sapi/$(SVC_TARBALL)
	cp $(TOP)/$(AGENT_TARBALL) $(BITS_DIR)/sapi/$(AGENT_TARBALL)



include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.node_prebuilt.targ
include ./tools/mk/Makefile.node_deps.targ
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ
