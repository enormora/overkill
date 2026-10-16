import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { benchmarkHostSnapshot } from '../test-support/benchmark-host-snapshot.ts';
import { normalizeConfig } from '../config/config.ts';
import { readBenchmarkRunMetadata, benchmarkRunMediaType } from '../bench/benchmark-run-report.ts';
import { runJsonArtifact } from '../attachments/run-json-artifact.ts';
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

export const testNode = suite('benchmark host reporting', [
    test('reads historical metadata without inventing host evidence', function (scope: TestScope) {
        const result = runResultFactory.build({});
        const artifact = runJsonArtifact({
            result,
            name: 'benchmark-run',
            mediaType: benchmarkRunMediaType,
            maxBytes: 4096,
            capturedAtMicroseconds: 0,
            value: {
                version: 1,
                node: { arch: 'x64', platform: 'linux', version: '26.9.0' },
                calibration: null,
                execution: {
                    profile: 'legacy',
                    processModel: 'worker-pool',
                    scheduling: 'serial',
                    maxConcurrency: 1,
                    workerCount: 1,
                    workerLifecycle: 'reuse'
                }
            }
        });
        const decoded = readBenchmarkRunMetadata({ ...result, artifacts: [ artifact ] });
        scope.assert.equal(decoded?.host, null);
        scope.assert.equal(decoded?.version, 2);
        scope.assert.equal(decoded?.execution.profile, 'legacy');
        return scope.assert.collect();
    }),
    test(
        'retains existing host evidence through fallback error metadata and HTML reporting',
        function (scope: TestScope) {
            const command = benchmarkCommand();
            const profile = command.config.profiles.startup;
            if (profile?.testFamily !== 'benchmark') {
                throw new Error('Missing benchmark profile.');
            }
            const recorded = withBenchmarkErrorMetadata(runResultFactory.build({}), command, {
                snapshot: benchmarkHostSnapshot(),
                limits: profile.host.limits,
                checks: []
            });
            const fallback = withBenchmarkErrorMetadata(recorded, command, null);
            scope.assert.equal(fallback, recorded);
            scope.assert.equal(fallback.artifacts.length, 1);
            scope.assert.includes(createBenchmarkHtmlReport(fallback).metadata, 'fixture-cpu');
            return scope.assert.collect();
        }
    )
]);
