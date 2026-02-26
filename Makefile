.PHONY: build run stub clean test

SANDBOX_IMAGE ?= gfx-challenge-sandbox:latest

build:
	@echo "Building sandbox Docker image..."
	SANDBOX_IMAGE=$(SANDBOX_IMAGE) bash scripts/build_sandbox_image.sh

run: build
	SANDBOX_IMAGE=$(SANDBOX_IMAGE) python generate.py

stub: build
	SANDBOX_IMAGE=$(SANDBOX_IMAGE) python generate.py --stub

clean:
	@echo "Stopping all gfx-challenge containers..."
	-docker ps -q --filter "label=managed-by=gfx-challenge" | xargs -r docker stop
	-docker ps -aq --filter "label=managed-by=gfx-challenge" | xargs -r docker rm
	@echo "Removing temp files..."
	rm -rf /tmp/gfx-*
	@echo "Clean complete."

test:
	python -m pytest tests/ -v
