ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
BIN  := $(ROOT)bin
AGENT_SRC := $(ROOT)agent

.PHONY: build-agent clean-agent dev setup-certs

build-agent:
	cd $(AGENT_SRC) && go build -o $(BIN)/repolume-agent ./cmd/repolume-agent/
	@echo "Built: $(BIN)/repolume-agent"

clean-agent:
	rm -f $(BIN)/repolume-agent

setup-certs:
	@echo "Exporting macOS system + login keychain certs for corporate SSL..."
	@mkdir -p $(ROOT)api/certs
	@security export -t certs -f pemseq -k /Library/Keychains/System.keychain -o /tmp/_sys.pem 2>/dev/null || true
	@security export -t certs -f pemseq -k ~/Library/Keychains/login.keychain-db -o /tmp/_login.pem 2>/dev/null || true
	@poetry -C api run python -c "import certifi; print(certifi.where())" > /tmp/_certifi_path.txt 2>/dev/null || echo "" > /tmp/_certifi_path.txt
	@CERTIFI=$$(cat /tmp/_certifi_path.txt); cat /tmp/_sys.pem /tmp/_login.pem "$${CERTIFI}" > $(ROOT)api/certs/ca-bundle.pem 2>/dev/null || cat /tmp/_sys.pem /tmp/_login.pem > $(ROOT)api/certs/ca-bundle.pem
	@rm -f /tmp/_sys.pem /tmp/_login.pem /tmp/_certifi_path.txt
	@echo "✅ api/certs/ca-bundle.pem created (gitignored)"

dev:
	$(MAKE) build-agent
	cd $(ROOT) && poetry -C api run python -m api.main
