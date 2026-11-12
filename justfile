export PATH := './node_modules/.bin:' + env_var('PATH')
package-smoke-packages := '@overkill-dev/linearizability,@overkill-dev/differential,@overkill-dev/model,@overkill-dev/reporter-benchmark-html,@overkill-dev/baselines,@overkill-dev/bench,@overkill-dev/engine,@overkill-dev/assert,@overkill-dev/doubles,@overkill-dev/simulation,@overkill-dev/resources,@overkill-dev/run,@overkill-dev/stryker-runner,@overkill-dev/type-test,@overkill-dev/property,@overkill-dev/test,@overkill-dev/reporter-line,@overkill-dev/reporter-brief,@overkill-dev/reporter-dot,@overkill-dev/reporter-opentelemetry,@overkill-dev/output-renderer-github-actions'
mutation-smoke-packages := '@overkill-dev/engine,@overkill-dev/run,@overkill-dev/stryker-runner,@overkill-dev/reporter-line'
packtory-node-options := '--max-old-space-size-percentage=75'

default:
    @just --list

compile: benchmark-html-browser
    tsc --build
    tsc --project source/tsconfig.sources.json --outDir target/package-build --tsBuildInfoFile target/buildcache/package-sources.tsbuildinfo

benchmark-html-browser:
    node build-benchmark-html.js

eslint *OPTIONS:
    eslint . --cache --cache-location './target/.eslintcache' --cache-strategy content --max-warnings 0 {{OPTIONS}}

eslint-fix: (eslint '--fix')

lint-filename:
    ls-lint

lint-unused-code:
    knip

lint-dependencies:
    depcruise source --config dependency-cruiser.config.js

lint-duplication *OPTIONS:
    jscpd source --config jscpd.json {{OPTIONS}}

lint: eslint lint-filename lint-unused-code lint-dependencies lint-duplication

lint-fix: eslint-fix

test-unit: benchmark-html-browser
    node source/overkill.test.ts

test-mutation-integration: benchmark-html-browser
    node source/integration-tests/run/runner-mutation-accuracy.test.ts
    node source/integration-tests/run/runner-mutation-cost.test.ts
    node source/integration-tests/run/runner-mutation-boundaries.test.ts
    node source/integration-tests/run/runner-mutation-execution.test.ts
    node source/integration-tests/run/runner-mutation-policy.test.ts
    node source/integration-tests/run/runner-frozen-policy.test.ts
    node source/integration-tests/run/runner-frozen-policy-activation.test.ts
    node source/integration-tests/run/runner-stryker-lifecycle.test.ts
    node source/integration-tests/run/runner-stryker-worker-reuse.test.ts
    node source/integration-tests/run/runner-stryker-catalog.test.ts
    node source/integration-tests/run/runner-stryker-dry-run.test.ts
    node source/integration-tests/run/runner-stryker-classification.test.ts
    node source/integration-tests/run/runner-stryker-timeouts.test.ts
    node source/integration-tests/run/runner-stryker-termination.test.ts
    node source/integration-tests/run/runner-stryker-ownership.test.ts
    node source/integration-tests/run/runner-stryker-persistence.test.ts

test-property-integration: benchmark-html-browser
    node source/property/property-suite.test.ts
    node source/run/corpus-suite.test.ts
    node source/run/property-corpus-storage.test.ts
    node source/run/property-corpus-execution.test.ts
    node source/run/property-witness-storage.test.ts
    node source/integration-tests/run/runner-replay-witness.test.ts
    node source/integration-tests/run/runner-property-validation.test.ts
    node source/integration-tests/run/runner-property-measurements.test.ts

test-runner-integration: test-mutation-integration
    node source/integration-tests/run/runner-content-snapshots.test.ts
    node source/integration-tests/run/runner-ordinary-baselines.test.ts
    node source/integration-tests/run/runner-replay-coverage.test.ts
    node source/integration-tests/run/runner-replay-compatibility.test.ts
    node source/integration-tests/run/runner-replay.test.ts
    node source/integration-tests/run/runner-replay-witness.test.ts
    node source/integration-tests/run/runner-replay-simulation.test.ts
    node source/integration-tests/run/runner-record-policy.test.ts
    node source/integration-tests/run/process-owner-death.test.ts
    node source/integration-tests/run/process-lifetime.test.ts
    node source/integration-tests/run/process-execution.test.ts
    node source/integration-tests/run/runner-external-process.test.ts
    node source/integration-tests/run/runner-module-imports.test.ts
    node source/integration-tests/run/runner-benchmark-normalization.test.ts
    node source/integration-tests/run/runner-benchmark-garbage-collection.test.ts
    node source/integration-tests/run/runner-benchmark-placement.test.ts
    node source/integration-tests/run/runner-benchmark-host.test.ts
    node source/integration-tests/run/runner-property-policy.test.ts
    node source/integration-tests/run/runner-property-validation.test.ts
    node source/integration-tests/run/runner-property-measurements.test.ts
    node source/integration-tests/run/runner-benchmark-html.test.ts
    node source/integration-tests/run/runner-measurements.test.ts
    node source/integration-tests/run/runner-supervised-cancellation.test.ts
    node source/integration-tests/run/runner-collected-lifecycle.test.ts
    node source/integration-tests/run/runner-workloads.test.ts
    node source/integration-tests/run/runner-benchmark-baseline-cli.test.ts
    node source/integration-tests/run/runner-benchmark-baseline-failures.test.ts
    node source/integration-tests/run/runner-benchmark-baselines.test.ts
    node source/integration-tests/run/runner-benchmarks.test.ts
    node source/integration-tests/run/runner-attachments.test.ts
    node source/integration-tests/run/runner-attachment-retention.test.ts
    node source/integration-tests/run/runner-retries.test.ts
    node source/integration-tests/run/runner-ipc-results.test.ts
    node source/integration-tests/run/runner-coverage-branches.test.ts
    node source/integration-tests/run/runner-coverage.test.ts
    node source/integration-tests/run/runner-coverage-records.test.ts
    node source/integration-tests/run/runner-coverage-sources.test.ts
    node source/integration-tests/run/runner-explicit-files.test.ts
    node source/integration-tests/run/runner-supervised-timeouts.test.ts
    node source/integration-tests/run/runner-file-sets.test.ts
    node source/integration-tests/run/runner-output.test.ts
    node source/integration-tests/run/runner-command-line.test.ts
    node source/integration-tests/run/runner-capability-policy.test.ts
    node source/integration-tests/run/runner-process-policy.test.ts

test-unit-with-coverage:
    c8 --config .c8rc.json node source/overkill.test.ts

test-types:
    tstyche

_pack-smoke-packages packages: compile
    rm -rf target/build/source/node_modules
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    rm -rf target/package-smoke
    mkdir -p target/package-smoke/node_modules
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" PACKTORY_INCLUDED_PACKAGES={{packages}} packtory pack --all --format folder --version 0.0.0 --vendor-dependencies --out target/package-smoke/node_modules
    ln -s ../../../../package-smoke/node_modules target/build/source/integration-tests/package-smoke/node_modules

test-linearizability-package-smoke: compile
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    rm -rf target/linearizability-package-smoke
    mkdir -p target/linearizability-package-smoke/node_modules/@overkill-dev
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" PACKTORY_INCLUDED_PACKAGES=@overkill-dev/linearizability,@overkill-dev/assert,@overkill-dev/model,@overkill-dev/property,@overkill-dev/engine,@overkill-dev/simulation,@overkill-dev/resources,@overkill-dev/run packtory pack @overkill-dev/linearizability --format folder --version 0.0.0 --vendor-dependencies --out target/linearizability-package-smoke/node_modules/@overkill-dev/linearizability
    ln -s linearizability/node_modules/@overkill-dev/engine target/linearizability-package-smoke/node_modules/@overkill-dev/engine
    ln -s linearizability/node_modules/@overkill-dev/property target/linearizability-package-smoke/node_modules/@overkill-dev/property
    ln -s ../../../../linearizability-package-smoke/node_modules target/build/source/integration-tests/package-smoke/node_modules
    node target/build/source/integration-tests/package-smoke/linearizability.test.js
    rm -rf target/build/source/integration-tests/package-smoke/node_modules

test-mutation-package-smoke: (_pack-smoke-packages mutation-smoke-packages)
    node target/build/source/integration-tests/package-smoke/stryker-accuracy.test.js
    node target/build/source/integration-tests/package-smoke/stryker-interruptions.test.js
    node target/build/source/integration-tests/package-smoke/stryker-persistence.test.js
    rm -rf target/build/source/integration-tests/package-smoke/node_modules

test-package-smoke: (_pack-smoke-packages package-smoke-packages)
    node target/build/source/integration-tests/package-smoke/content-snapshots.test.js
    node target/build/source/integration-tests/package-smoke/engine-direct-execution.test.js
    node target/build/source/integration-tests/package-smoke/run-lifecycle.test.js
    node target/build/source/integration-tests/package-smoke/benchmark-html.test.js
    node target/build/source/integration-tests/package-smoke/bench.test.js
    node target/build/source/integration-tests/package-smoke/property.test.js
    node target/build/source/integration-tests/package-smoke/model.test.js
    node target/build/source/integration-tests/package-smoke/differential.test.js
    node target/build/source/integration-tests/package-smoke/linearizability.test.js
    node target/build/source/integration-tests/package-smoke/type-test.test.js
    node target/build/source/integration-tests/package-smoke/stryker-runner.test.js
    node target/build/source/integration-tests/package-smoke/stryker-accuracy.test.js
    node target/build/source/integration-tests/package-smoke/stryker-persistence.test.js
    node target/build/source/integration-tests/package-smoke/test-binary.test.js
    node target/build/source/integration-tests/package-smoke/test-binary-permissions.test.js
    node target/build/source/integration-tests/package-smoke/test-binary-attachments.test.js
    node target/build/source/integration-tests/package-smoke/test-binary-coverage.test.js
    rm -rf target/build/source/integration-tests/package-smoke/node_modules

publish-dry-run: compile
    rm -rf target/build/source/node_modules
    rm -rf target/build/source/integration-tests/package-smoke/node_modules
    NODE_OPTIONS="${NODE_OPTIONS:-} {{packtory-node-options}}" packtory publish

benchmark-mutation-cost: compile
    node target/build/source/packages/test/overkill.entry-point.js bench run --profile mutation-cost --seed 42 --order lexical
