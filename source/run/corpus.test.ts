import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { capturePropertyInput } from '../property/property-graph.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/property-corpus.ts';
import { inspectCorpus, promoteWitness, migrateCorpus, type CorpusRequest } from '../packages/run/run.entry-point.ts';

type CorpusFixture = { readonly cwd: string; readonly witness: PropertyWitnessFile; readonly request: CorpusRequest; };
async function fixture(scope: TestScope): Promise<CorpusFixture> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'overkill-corpus-api-'));
    scope.cleanup(async function remove() {
        await rm(cwd, { recursive: true, force: true });
    });
    const witness = propertyWitnessSchema.parse({
        ...propertyCorpusEntry,
        counterexample: capturePropertyInput({ amount: 42n }, null, function () {
            return undefined;
        })
    });
    await writeFile(path.join(cwd, 'witness.json'), JSON.stringify(witness));
    return {
        cwd,
        witness,
        request: { cwd, source: { kind: 'path' as const, path: 'witness.json' }, codec: { kind: 'built-in' as const } }
    };
}
export const testNode = suite('corpus operations', [
    test('inspection decodes without modifying the witness', async function (scope) {
        const { cwd, witness, request } = await fixture(scope);
        const result = await inspectCorpus(request);
        scope.assert.equal(result.entries.length, 1);
        scope.assert.deepEqual(
            propertyWitnessSchema.parse(JSON.parse(await readFile(path.join(cwd, 'witness.json'), 'utf8'))),
            witness
        );
        return scope.assert.collect();
    }),
    test('promotion delivers a preview before publishing unchanged input', async function (scope) {
        const { cwd, witness, request } = await fixture(scope);
        const result = await promoteWitness({
            ...request,
            destination: 'output.json',
            async beforeWrite(preview) {
                await scope.assert.rejects(async function absent() {
                    await access(path.join(cwd, 'output.json'));
                }, { message: /ENOENT/v });
                scope.assert.deepEqual(preview.output.witness, witness);
            }
        });
        scope.assert.deepEqual(
            propertyWitnessSchema.parse(JSON.parse(await readFile(result.destination, 'utf8'))),
            witness
        );
        return scope.assert.collect();
    }),
    test('preview rejection prevents destination creation', async function (scope) {
        const { cwd, request } = await fixture(scope);
        await scope.assert.rejects(async function delivery() {
            await promoteWitness({
                ...request,
                destination: 'nested/output.json',
                async beforeWrite() {
                    throw new Error('output failed');
                }
            });
        }, { message: /preview delivery failed/v });
        await scope.assert.rejects(async function untouched() {
            await access(path.join(cwd, 'nested'));
        }, { message: /ENOENT/v });
        return scope.assert.collect();
    }),
    test('preview mutation cannot change the verified output', async function (scope) {
        const { witness, request } = await fixture(scope);
        const result = await promoteWitness({
            ...request,
            destination: 'immutable.json',
            async beforeWrite(preview) {
                Reflect.set(preview.output.witness, 'seed', '999');
            }
        });
        scope.assert.deepEqual(result.entry.witness, witness);
        scope.assert.deepEqual(
            propertyWitnessSchema.parse(JSON.parse(await readFile(result.destination, 'utf8'))),
            witness
        );
        return scope.assert.collect();
    }),
    test('standalone inspection rejects unsupported formats', async function (scope) {
        const { cwd, witness, request } = await fixture(scope);
        await writeFile(
            path.join(cwd, 'witness.json'),
            JSON.stringify({
                ...witness,
                counterexample: { ...witness.counterexample, format: { name: 'unsupported', version: 1 } }
            })
        );
        await scope.assert.rejects(async function incompatible() {
            await inspectCorpus(request);
        }, { message: /Unsupported corpus transport format/v });
        return scope.assert.collect();
    }),
    test('migration writes separately and rejects existing destinations', async function (scope) {
        const { request, witness } = await fixture(scope);
        const write = {
            ...request,
            destination: 'migrated.json',
            async beforeWrite() {
                return undefined;
            }
        };
        const result = await migrateCorpus(write);
        scope.assert.deepEqual(result.entry.witness, witness);
        await scope.assert.rejects(async function conflict() {
            await migrateCorpus(write);
        }, { message: /Cannot create corpus destination/v });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
