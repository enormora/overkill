import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite } from '@overkill-dev/test';

import { z } from 'zod/v4';

import type { RunResult } from '../../packages/engine/engine.entry-point.ts';

import {
    isolatedRunStateDirectory,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { coverageSubject } from './support/coverage-subject.ts';

const fixtureRoot = 'source/integration-tests/runtime/fixtures';
const branchReportSchema = z.record(
    z.string(),
    z.object({
        b: z.record(z.string(), z.array(z.number())),
        f: z.record(z.string(), z.number())
    })
);

async function executeGenericCoverage(processModel: 'in-process' | 'supervised-process'): Promise<RunResult> {
    return await coverageSubject.run({
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
            runtimeStateDir: isolatedRunStateDirectory()
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            coverage: true,
            paths: [ `${fixtureRoot}/coverage-generics.test.ts` ]
        })
    });
}

const assertGenericCoverageReports = defineCompositeAssertion({
    name: 'generic coverage reports',
    async assert(check, reportDirectory: string) {
        const report = branchReportSchema.parse(JSON.parse(
            await readFile(path.join(reportDirectory, 'coverage-final.json'), 'utf8')
        ));
        const initialChecks = check.group([
            check.deepEqual(Object.keys(report), [ `${fixtureRoot}/coverage-generics.ts` ]),
            check.deepEqual(
                Object.values(report).map(function counts(file) {
                    return { branches: file.b, functions: file.f };
                }),
                [ { branches: { 0: [ 2, 1 ] }, functions: { 0: 3 } } ]
            )
        ]);
        const lcov = await readFile(path.join(reportDirectory, 'lcov.info'), 'utf8');
        return check.group([
            initialChecks,
            check.deepEqual(
                Array.from(lcov.matchAll(/^BRDA:3,0,[01],(?<count>\d+)$/gmu), function branchCount(match) {
                    return Number(match.groups?.count);
                }),
                [ 2, 1 ]
            ),
            check.includes(lcov, 'BRF:2\nBRH:2\n')
        ]);
    }
});

export const testNode = suite(
    'Runner coverage branches',
    [ table({
        title: 'coverage preserves generic method branch counts',
        cases: [ 'in-process', 'supervised-process' ] as const,
        caseTitle: String,
        async test(scope) {
            const result = await executeGenericCoverage(scope.parameters);
            scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
            scope.assert.equal(result.summary.passed, 3);
            const artifact = result.artifacts.find(function isCoverage(candidate) {
                return candidate.payload.kind === 'coverage';
            });
            if (artifact?.payload.kind !== 'coverage') {
                throw new Error('Expected a coverage artifact.');
            }
            scope.assert.deepEqual({
                branches: artifact.payload.summary.branches,
                functions: artifact.payload.summary.functions
            }, { branches: { covered: 2, total: 2 }, functions: { covered: 1, total: 1 } });
            await scope.assert(assertGenericCoverageReports, path.resolve(artifact.payload.directory));
            return scope.assert.collect();
        }
    }) ]
);
