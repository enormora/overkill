import { type TestScope, suite, test } from '@overkill-dev/test';

import type { RunResult } from '../engine/run-result.ts';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { benchmarkHostSnapshot } from '../test-support/benchmark-host-snapshot.ts';
import { normalizeConfig } from '../config/config.ts';
import { readBenchmarkRunMetadata } from '../bench/benchmark-run-report.ts';
import { createBenchmarkHtmlReport } from '../reporters/benchmark-html-model.ts';
import type { RunCommand } from './run-types.ts';
import { withBenchmarkErrorMetadata } from './benchmark-report-metadata.ts';

function benchmarkCommand(): RunCommand {
    return {
        cwd: '/project',
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'startup' }),
        config: normalizeConfig({
            profiles: { startup: { testFamily: 'benchmark', files: { include: [ 'sample.bench.ts' ] } } }
        })
    };
}

function preparedBenchmark(): RunResult {
    const command = benchmarkCommand();
    const profile = command.config.profiles.startup;
    if (profile === undefined) {
        throw new Error('Expected profile to satisfy defined.');
    }
    if (profile.testFamily !== 'benchmark') {
        throw new Error('Expected benchmark profile.');
    }
    return withBenchmarkErrorMetadata(runResultFactory.build({}), command, {
        snapshot: benchmarkHostSnapshot(),
        limits: profile.host.limits,
        checks: []
    });
}
export const testNode = suite('benchmark host reporting', [
    test('preserves host evidence through fallback preparation', function (scope: TestScope) {
        const result = preparedBenchmark();
        const fallback = withBenchmarkErrorMetadata(result, benchmarkCommand(), null);
        scope.assert.equal(fallback, result);
        scope.assert.equal(fallback.artifacts.length, 0);
        const metadata = readBenchmarkRunMetadata(fallback.preparationFacts);
        scope.require.defined(metadata?.host);
        scope.assert.includes(JSON.stringify(metadata.host.snapshot.capacity.cpuModels), 'fixture-cpu');
        return scope.assert.collect();
    }),
    test('HTML reporting reads host evidence from the report context', function (scope) {
        const result = preparedBenchmark();
        scope.assert.includes(
            createBenchmarkHtmlReport({
                result,
                context: {
                    id: null,
                    startedAt: null,
                    facts: result.preparationFacts
                }
            })
                .metadata,
            'fixture-cpu'
        );
        return scope.assert.collect();
    })
]);
