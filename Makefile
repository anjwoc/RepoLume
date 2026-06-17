ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
BIN  := $(ROOT)bin
AGENT_SRC := $(ROOT)agent

.PHONY: build-agent clean-agent dev

build-agent:
	cd $(AGENT_SRC) && go build -o $(BIN)/localwiki-agent ./cmd/localwiki-agent/
	@echo "Built: $(BIN)/localwiki-agent"

clean-agent:
	rm -f $(BIN)/localwiki-agent

dev:
	$(MAKE) build-agent
	cd $(ROOT) && poetry -C api run python -m api.main
