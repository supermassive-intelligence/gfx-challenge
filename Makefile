# Berzerk Emulator - Literate Build System
#
# Workflow:
#   noweb/*.nw  --notangle-->  src/*.cpp, include/*.h
#   noweb/*.nw  --noweave-->   doc/*.tex  --pdflatex-->  doc/*.pdf
#   src/*.cpp   --g++-->       build/berzerk

# Directories
NW_DIR    := noweb
SRC_DIR   := src
INC_DIR   := include
DOC_DIR   := doc
BUILD_DIR := build
ROM_DIR   := rom

# Find all noweb source files
NW_SRCS := $(wildcard $(NW_DIR)/*.nw)

# Docker
DOCKER_IMAGE := berzerk-build
DOCKER_TAG   := latest

# Compiler
CXX      := g++
CXXFLAGS := -std=c++17 -Wall -Wextra -g -O2
LDFLAGS  := $(shell pkg-config --libs sdl2 2>/dev/null)
INCLUDES := -I$(INC_DIR) $(shell pkg-config --cflags sdl2 2>/dev/null)

# Build target
TARGET := $(BUILD_DIR)/berzerk

# Tangled sources (populated once .nw files exist)
CPP_SRCS := $(wildcard $(SRC_DIR)/*.cpp)
OBJECTS  := $(patsubst $(SRC_DIR)/%.cpp,$(BUILD_DIR)/%.o,$(CPP_SRCS))

# ============================================================
# Primary targets
# ============================================================

.PHONY: all tangle weave build clean docker-build docker-shell help test-z80 docker-test-z80 docker-play cosim-test docker-cosim-test

all: tangle build

help:
	@echo "Targets:"
	@echo "  tangle       - Extract C++ from noweb sources"
	@echo "  weave        - Generate documentation from noweb sources"
	@echo "  build        - Compile the emulator binary (native)"
	@echo "  all          - tangle + build"
	@echo "  clean        - Remove generated files"
	@echo "  docker-build - Build the Docker build environment"
	@echo "  docker-run   - Build and run the emulator inside Docker"
	@echo "  docker-shell - Open a shell in the Docker environment"
	@echo "  docker-all   - Build everything inside Docker"
	@echo "  test-z80     - Run Z80 SingleStepTests validation"
	@echo "  docker-test-z80 - Run Z80 tests inside Docker"
	@echo "  docker-play  - Run emulator in Docker with noVNC (browser at localhost:6080)"

# ============================================================
# Tangle: .nw -> .cpp / .h
# ============================================================

tangle: $(NW_SRCS)
	@mkdir -p $(SRC_DIR) $(INC_DIR)
	@for nw in $(NW_SRCS); do \
		echo "Tangling $$nw ..."; \
		for chunk in $$(grep -oE '^<<[^>]+\.cpp>>' $$nw | sed 's/^<<//;s/>>//' | sort -u); do \
			notangle -R"$$chunk" $$nw > $(SRC_DIR)/$$chunk; \
			echo "  -> $(SRC_DIR)/$$chunk"; \
		done; \
		for chunk in $$(grep -oE '^<<[^>]+\.h>>' $$nw | sed 's/^<<//;s/>>//' | sort -u); do \
			notangle -R"$$chunk" $$nw > $(INC_DIR)/$$chunk; \
			echo "  -> $(INC_DIR)/$$chunk"; \
		done; \
		for chunk in $$(grep -oE '^<<[^>]+\.asm>>' $$nw | sed 's/^<<//;s/>>//' | sort -u); do \
			notangle -R"$$chunk" $$nw > $(SRC_DIR)/$$chunk; \
			echo "  -> $(SRC_DIR)/$$chunk"; \
		done; \
	done
	@echo "Tangle complete."

# ============================================================
# Weave: .nw -> .tex -> .pdf
# ============================================================

weave: $(NW_SRCS)
	@mkdir -p $(DOC_DIR)
	@for nw in $(NW_SRCS); do \
		echo "Weaving $$nw ..."; \
		base=$$(basename $$nw .nw); \
		noweave -autodefs c -index $$nw > $(DOC_DIR)/$$base.tex; \
		echo "  -> $(DOC_DIR)/$$base.tex"; \
		(cd $(DOC_DIR) && pdflatex -interaction=nonstopmode $$base.tex && \
		pdflatex -interaction=nonstopmode $$base.tex); \
		echo "  -> $(DOC_DIR)/$$base.pdf"; \
	done
	@echo "Weave complete."

# ============================================================
# Build: compile tangled C++ sources
# ============================================================

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp
	@mkdir -p $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $< -o $@

build: tangle
	@mkdir -p $(BUILD_DIR)
	@srcs=$$(ls $(SRC_DIR)/*.cpp 2>/dev/null | grep -v -e z80_test.cpp -e cosim_test.cpp); \
	if [ -z "$$srcs" ]; then \
		echo "Error: No .cpp files found in $(SRC_DIR)/ after tangle."; \
		exit 1; \
	fi; \
	objs=""; \
	for src in $$srcs; do \
		obj=$(BUILD_DIR)/$$(basename $$src .cpp).o; \
		objs="$$objs $$obj"; \
		echo "$(CXX) $(CXXFLAGS) $(INCLUDES) -c $$src -o $$obj"; \
		$(CXX) $(CXXFLAGS) $(INCLUDES) -c $$src -o $$obj || exit 1; \
	done; \
	echo "$(CXX) $(CXXFLAGS) $$objs $(LDFLAGS) -o $(TARGET)"; \
	$(CXX) $(CXXFLAGS) $$objs $(LDFLAGS) -o $(TARGET); \
	echo "Built $(TARGET)"

# ============================================================
# Z80 Test Suite
# ============================================================

TEST_Z80_TARGET := $(BUILD_DIR)/z80_test
TEST_Z80_DIR    := tests/z80/v1

test-z80: tangle
	@mkdir -p $(BUILD_DIR)
	@echo "Building Z80 test runner..."
	$(CXX) $(CXXFLAGS) $(INCLUDES) -Ithird_party -c $(SRC_DIR)/z80_test.cpp -o $(BUILD_DIR)/z80_test.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/z80.cpp -o $(BUILD_DIR)/z80.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/memory.cpp -o $(BUILD_DIR)/memory.o
	$(CXX) $(CXXFLAGS) $(BUILD_DIR)/z80_test.o $(BUILD_DIR)/z80.o $(BUILD_DIR)/memory.o -o $(TEST_Z80_TARGET)
	@echo "Built $(TEST_Z80_TARGET)"
	@if [ -d "$(TEST_Z80_DIR)" ]; then \
		echo "Running Z80 tests from $(TEST_Z80_DIR)..."; \
		$(TEST_Z80_TARGET) $(TEST_Z80_DIR); \
	else \
		echo "Error: Test data not found at $(TEST_Z80_DIR)"; \
		echo "Run: git clone --depth 1 https://github.com/SingleStepTests/z80.git tests/z80"; \
		exit 1; \
	fi

docker-test-z80: docker-build
	docker run --rm \
		-v $(CURDIR)/tests:/workspace/tests:ro \
		-v $(CURDIR)/third_party:/workspace/third_party:ro \
		-v $(CURDIR)/noweb:/workspace/noweb:ro \
		$(DOCKER_IMAGE):$(DOCKER_TAG) \
		make test-z80

# ============================================================
# Cosimulation Test
# ============================================================

COSIM_TEST_TARGET := $(BUILD_DIR)/cosim_test

cosim-test: tangle
	@mkdir -p $(BUILD_DIR)
	@echo "Building cosimulation test..."
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/cosim_test.cpp -o $(BUILD_DIR)/cosim_test.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/cosim.cpp -o $(BUILD_DIR)/cosim.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/cosim_harness.cpp -o $(BUILD_DIR)/cosim_harness.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/emulator.cpp -o $(BUILD_DIR)/emulator.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/native.cpp -o $(BUILD_DIR)/native.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/z80.cpp -o $(BUILD_DIR)/z80.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/memory.cpp -o $(BUILD_DIR)/memory.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/berzerk_map.cpp -o $(BUILD_DIR)/berzerk_map.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/video.cpp -o $(BUILD_DIR)/video.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/sound.cpp -o $(BUILD_DIR)/sound.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/interrupts.cpp -o $(BUILD_DIR)/interrupts.o
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $(SRC_DIR)/platform.cpp -o $(BUILD_DIR)/platform.o
	$(CXX) $(CXXFLAGS) $(BUILD_DIR)/cosim_test.o $(BUILD_DIR)/cosim.o $(BUILD_DIR)/cosim_harness.o \
		$(BUILD_DIR)/emulator.o $(BUILD_DIR)/native.o $(BUILD_DIR)/z80.o $(BUILD_DIR)/memory.o \
		$(BUILD_DIR)/berzerk_map.o $(BUILD_DIR)/video.o $(BUILD_DIR)/sound.o \
		$(BUILD_DIR)/interrupts.o $(BUILD_DIR)/platform.o $(LDFLAGS) -o $(COSIM_TEST_TARGET)
	@echo "Built $(COSIM_TEST_TARGET)"
	@echo "Running cosimulation tests..."
	$(COSIM_TEST_TARGET) $(ROM_DIR)/berzerk

docker-cosim-test: docker-build
	docker run --rm \
		-v $(CURDIR)/rom:/workspace/rom:ro \
		$(DOCKER_IMAGE):$(DOCKER_TAG) \
		make cosim-test

# ============================================================
# Clean
# ============================================================

clean:
	rm -rf $(BUILD_DIR)
	rm -f $(SRC_DIR)/*.cpp $(INC_DIR)/*.h
	rm -f $(DOC_DIR)/*.tex $(DOC_DIR)/*.pdf $(DOC_DIR)/*.aux $(DOC_DIR)/*.log $(DOC_DIR)/*.toc $(DOC_DIR)/*.out

# ============================================================
# Docker targets
# ============================================================

docker-build:
	docker build -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker-shell: docker-build
	docker run --rm -it \
		-v $(CURDIR)/rom:/workspace/rom:ro \
		$(DOCKER_IMAGE):$(DOCKER_TAG) \
		/bin/bash

docker-run: docker-build
	docker run --rm \
		-v $(CURDIR)/rom:/workspace/rom:ro \
		$(DOCKER_IMAGE):$(DOCKER_TAG) \
		bash -c "make build && ./build/berzerk"

docker-all: docker-build
	docker run --rm \
		-v $(CURDIR)/rom:/workspace/rom:ro \
		-v $(CURDIR)/doc:/workspace/doc \
		$(DOCKER_IMAGE):$(DOCKER_TAG) \
		make all weave

# ============================================================
# noVNC browser display target
# ============================================================

NOVNC_IMAGE := berzerk-novnc

docker-play:
	docker build -f Dockerfile.novnc -t $(NOVNC_IMAGE):$(DOCKER_TAG) .
	@echo ""
	@echo "Open http://localhost:6080/vnc.html in your browser"
	@echo "Press Ctrl-C to stop"
	@echo ""
	docker run --rm -it \
		-p 6080:6080 \
		-v $(CURDIR)/rom:/workspace/rom:ro \
		$(NOVNC_IMAGE):$(DOCKER_TAG)
