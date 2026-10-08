import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import {
    createSuite,
    createTestCase,
    type RunResult,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const fixtureRoot = 'source/integration-tests/run/fixtures';
const branchReportSchema = z.record(
    z.string(),
    z.object({
        b: z.record(z.string(), z.array(z.number())),
        f: z.record(z.string(), z.number())
    })
);

async function executeGenericCoverage(processModel: 'in-process' | 'supervised-process'): Promise<RunResult> {
    return await orchestrator.run({
        config: defaultRunConfig({
            profiles: {
                microtest: defaultMicrotestProfile({
                    coverage: {
                        outputs: [ 'json', 'lcov' ],
                        sources: {
                            exclude: [],
                            include: [ `${fixtureRoot}/coverage-generics.ts` ],
                            mode: 'all'
                        },
                        thresholds: { branches: 100, functions: 100, lines: 100 }
                    },
                    execution: { processModel, scheduling: 'serial' },
                    timeouts: {
                        collectionMilliseconds: 10_000,
                        hardMilliseconds: 10_000,
                        softMilliseconds: 5000
                    }
                })
            },
            runtimeStateDir: 'target/coverage-branches-integration'
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            coverage: true,
            paths: [ `${fixtureRoot}/coverage-generics.test.ts` ]
        })
    });
}

async function assertGenericCoverageReports(scope: TestScope, reportDirectory: string): Promise<void> {
    const report = branchReportSchema.parse(JSON.parse(
        await readFile(path.join(reportDirectory, 'coverage-final.json'), 'utf8')
    ));
    scope.assert.deepEqual(Object.keys(report), [ `${fixtureRoot}/coverage-generics.ts` ]);
    scope.assert.deepEqual(
        Object.values(report).map(function counts(file) {
            return { branches: file.b, functions: file.f };
        }),
        [ { branches: { 0: [ 2, 1 ] }, functions: { 0: 3 } } ]
    );
    const lcov = await readFile(path.join(reportDirectory, 'lcov.info'), 'utf8');
    scope.assert.deepEqual(
        Array.from(lcov.matchAll(/^BRDA:3,0,[01],(?<count>\d+)$/gmu), function branchCount(match) {
            return Number(match.groups?.count);
        }),
        [ 2, 1 ]
    );
    scope.assert.includes(lcov, 'BRF:2\nBRH:2\n');
}

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-coverage-branches.test.ts',
    children: ([ 'in-process', 'supervised-process' ] as const).map(function processModelScenario(processModel) {
        return createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: `${processModel} coverage preserves generic method branch counts`,
            async body(scope: TestScope) {
                const result = await executeGenericCoverage(processModel);
                scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
                scope.assert.equal(result.summary.passed, 3);
                const artifact = result.artifacts.find(function isCoverage(candidate) {
                    return candidate.payload.kind === 'coverage';
                });
                scope.require.defined(artifact);
                if (artifact.payload.kind !== 'coverage') {
                    throw new Error('Expected a coverage artifact.');
                }
                scope.assert.deepEqual({
                    branches: artifact.payload.summary.branches,
                    functions: artifact.payload.summary.functions
                }, { branches: { covered: 2, total: 2 }, functions: { covered: 1, total: 1 } });
                await assertGenericCoverageReports(scope, path.resolve(artifact.payload.directory));
                return scope.assert.collect();
            }
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
