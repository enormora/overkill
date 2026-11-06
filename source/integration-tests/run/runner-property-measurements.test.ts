import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { z } from 'zod/v4';
import { runIfMain } from '#test-runner';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import { propertyWorkloads, type PropertyWorkload } from '../../test-support/property-workload.ts';

async function execute(args: readonly string[]): Promise<string> {
    return await new Promise(function executeDriver(resolve, reject) {
        execFile(process.execPath, Array.from(args), { timeout: 60_000 }, function completed(error, stdout, stderr) {
            if (error !== null) {
                reject(new Error('Measurement process failed.', { cause: error }));
                return;
            }
            if (stderr !== '') {
                reject(new Error(stderr));
                return;
            }
            resolve(stdout);
        });
    });
}
const count = z.number().int().nonnegative();
const measurement = z.strictObject({
    workload: z.enum(propertyWorkloads),
    seed: z.literal('42'),
    nodeVersion: z.string().min(1),
    size: count,
    depth: count,
    workConsumed: count.max(10_000),
    candidatesProduced: count,
    reconstructions: count,
    rejectedInputs: count,
    bodyEvaluations: count,
    checkpoints: count.positive(),
    baselineHeapBytes: count.positive(),
    maximumCheckpointHeapBytes: count.positive(),
    maximumCheckpointHeapDeltaBytes: count
});
async function measured(
    workload: PropertyWorkload,
    size: number,
    depth: number
): Promise<z.output<typeof measurement>> {
    const moduleUrl = new URL('../../test-support/property-workload.ts', import.meta.url);
    const module = moduleUrl.href;
    const driver = `const {measurePropertyWorkload} = await import(${JSON.stringify(module)});
        console.log(JSON.stringify(measurePropertyWorkload(${JSON.stringify(workload)}, ${size}, ${depth})));`;
    const result = await execute([ '--expose-gc', '--input-type=module', '--eval', driver ]);
    return measurement.parse(JSON.parse(result));
}
export const testNode = suite(
    'property workload measurements',
    propertyWorkloads.flatMap(function workloadCases(workload) {
        return [ { size: 8, depth: 2 }, { size: 64, depth: 5 } ].map(function workloadSize({ size, depth }) {
            return test(`${workload} size ${size} depth ${depth}`, async function (scope) {
                const first = await measured(workload, size, depth);
                const second = await measured(workload, size, depth);
                await mkdir('target/property-measurements', { recursive: true });
                await writeFile(
                    `target/property-measurements/${workload}-${size}-${depth}.json`,
                    JSON.stringify([ first, second ], null, 2)
                );
                scope.assert.deepEqual([ first.workload, first.nodeVersion, first.size, first.depth ], [
                    workload,
                    process.versions.node,
                    size,
                    depth
                ]);
                scope.assert.deepEqual(
                    [
                        first.workConsumed,
                        first.candidatesProduced,
                        first.reconstructions,
                        first.rejectedInputs,
                        first.bodyEvaluations
                    ],
                    [
                        second.workConsumed,
                        second.candidatesProduced,
                        second.reconstructions,
                        second.rejectedInputs,
                        second.bodyEvaluations
                    ]
                );
                scope.assert.equal(
                    first.maximumCheckpointHeapDeltaBytes,
                    first.maximumCheckpointHeapBytes - first.baselineHeapBytes
                );
                scope.assert.true(first.workConsumed > 0);
                scope.assert.equal(first.bodyEvaluations === 0, workload === 'impossible');
                return scope.assert.collect();
            });
        });
    })
);
await runIfMain(import.meta, testNode);
