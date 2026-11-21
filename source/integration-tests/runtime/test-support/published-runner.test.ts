import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestFacade } from '@overkill-dev/test';

import { createTemporaryDirectoryResource } from '@overkill-dev/test/resources';
import { z } from 'zod/v4';

const scratch = createTemporaryDirectoryResource('scratch');
const { table } = createTestFacade({ resources: { scratch } });
const binary = fileURLToPath(new URL('./overkill.entry-point.js', import.meta.resolve('@overkill-dev/test')));
const authoring = JSON.stringify(import.meta.resolve('@overkill-dev/test'));
const reporters = JSON.stringify(import.meta.resolve('@overkill-dev/test/reporters'));
const recordedExecution = z.object({
    result: z.object({
        summary: z.object({ passed: z.number() }),
        runnerErrors: z.array(z.unknown()),
        perTest: z.tuple([ z.object({ durationMicroseconds: z.number() }) ])
    })
});
const scenarios = [
    {
        title: 'measures elapsed integration case duration',
        family: 'integration',
        minimumDuration: 5000,
        source: `
import { test } from ${authoring};
import { setTimeout as wait } from 'node:timers/promises';
export const testNode = test('elapsed time', async (scope) => {
    await wait(10);
    scope.assert.true(true);
    return scope.assert.collect();
});
`
    },
    {
        title: 'keeps microtest bookkeeping outside runtime policy',
        family: 'microtest',
        minimumDuration: 0,
        source: `
import { test } from ${authoring};
export const testNode = test('passes', (scope) => {
    scope.assert.equal(2 + 3, 5);
    return scope.assert.collect();
});
`
    }
] as const;
type Scenario = typeof scenarios[number];

async function readRecordedExecution(directory: string): Promise<z.infer<typeof recordedExecution>> {
    const runsDirectory = join(directory, 'state', 'runs');
    const entries = await readdir(runsDirectory);
    const records = z.tuple([ z.string() ]).parse(entries.filter(function isRunRecord(entry) {
        return entry.endsWith('.json');
    }));
    return recordedExecution.parse(JSON.parse(await readFile(join(runsDirectory, records[0]), 'utf8')));
}

function projectConfiguration(scenario: Scenario): string {
    const profile = {
        testFamily: scenario.family,
        files: { include: [ 'case.test.ts' ] },
        execution: {
            processModel: scenario.family === 'microtest' ? 'in-process' : 'supervised-process',
            scheduling: 'serial'
        },
        timeouts: { collectionMilliseconds: 5000, softMilliseconds: 1000, hardMilliseconds: 5000 }
    };
    return `
import { createBriefFinalResultReporter } from ${reporters};
export const config = {
    runtimeStateDir: 'state',
    profiles: { check: { ...${JSON.stringify(profile)}, reporters: [createBriefFinalResultReporter()] } }
};
`;
}

async function executePublishedTests(cwd: string): Promise<string> {
    return await new Promise(function launchPublishedTests(resolve, reject) {
        execFile(process.execPath, [ '--permission-audit', binary, 'run', '--profile', 'check', '--seed', '42' ], {
            cwd,
            timeout: 10_000
        }, function (error, stdout, stderr) {
            if (error === null) {
                resolve(stdout);
            } else {
                reject(new Error(`Published CLI check failed: ${stderr}`, { cause: error }));
            }
        });
    });
}

export const testNode = table({
    title: 'published CLI',
    cases: scenarios,
    caseTitle(scenario) {
        return scenario.title;
    },
    async test(scope) {
        const directory = scope.resources.scratch.path;
        await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
        await writeFile(join(directory, 'case.test.ts'), scope.parameters.source);
        await writeFile(join(directory, 'overkill.config.js'), projectConfiguration(scope.parameters));
        scope.assert.includes(
            await executePublishedTests(directory),
            'done status=passed discovered=1 planned=1 executed=1 passed=1 failed=0'
        );
        const record = await readRecordedExecution(directory);
        scope.assert.equal(record.result.summary.passed, 1);
        scope.assert.deepEqual(record.result.runnerErrors, []);
        scope.assert.true(record.result.perTest[0].durationMicroseconds >= scope.parameters.minimumDuration);
        return scope.assert.collect();
    }
});
