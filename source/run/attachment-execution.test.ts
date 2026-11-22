import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite, test } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { exchangedAttachment, recordAttachmentExchange } from '../test-support/attachment-exchange.ts';
import { createAttachmentExecution } from './attachment-execution.ts';
import type { AttachmentOperation, AttachmentResponse } from './attachment-protocol.ts';

const work = createDefaultWorkId({ file: 'case.ts', suite: [], title: 'case', params: null });
const attempt = { index: 0 };
const owner = { kind: 'case', work, attempt } as const;
const metadata = { name: 'log', mediaType: 'application/json' };
const producer = { kind: 'case' } as const;

const assertPreparedOwner = defineCompositeAssertion({
    name: 'prepared owner',
    assert(check, operation: AttachmentOperation | undefined) {
        if (operation === undefined) {
            return check.defined(operation);
        }
        if (operation.kind !== 'prepare') {
            throw new Error('Expected a prepared attachment.');
        }
        return check.group([ check.equal(operation.owner.kind, 'case') ]);
    }
});

export const testNode = suite('attachment execution ownership', [
    test('sends a JSON snapshot with attempt and branch ownership', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
        const result = await execution.runBranch(
            'branch',
            async function () {
                return await execution.runAttempt(work, attempt, async function () {
                    return await execution
                        .context
                        .forProducer(producer)
                        .json(metadata, { ready: true });
                });
            }
        );
        scope.assert.equal(result, exchangedAttachment);
        scope.assert.deepEqual(recorded.operations, [
            { kind: 'open', contentKind: 'json', branch: 'branch', metadata, owner, producer },
            { kind: 'write', writer: 1, data: Buffer.from('{"ready":true}').toString('base64') },
            { kind: 'close', writer: 1, reason: 'complete' }
        ]);
        scope.assert.deepEqual(execution.takeErrors(owner), []);
        scope.assert.deepEqual(await execution.finish(), []);
        return scope.assert.collect();
    }),
    test('omits JSON that exceeds the inline limit', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, {
            ...defaultAttachmentLimits,
            maxInlineBytes: 1
        });
        await execution.context.forProducer(producer).json(metadata, { value: 1 });
        scope.assert.deepEqual(
            recorded.operations.map(function (operation) {
                return operation.kind;
            }),
            [ 'open', 'omit', 'close' ]
        );
        scope.assert.deepEqual(await execution.finish(), []);
        return scope.assert.collect();
    }),
    test('uses the artifact limit for prepared witnesses', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, {
            ...defaultAttachmentLimits,
            maxInlineBytes: 1
        });
        const condition = { kind: 'resource', resource: 'service', boundary: 'boundary' } as const;
        await execution.context.prepareForProducer(producer, condition, 'instrumented', 'witness').json(metadata, {
            value: 1
        });
        scope.assert.deepEqual(recorded.operations.slice(0, 1), [ {
            kind: 'prepare',
            condition,
            source: 'instrumented',
            subtype: 'witness',
            branch: null,
            owner: { kind: 'run' },
            producer,
            metadata,
            contentKind: 'json'
        } ]);
        scope.assert.equal(recorded.operations[1]?.kind, 'write');
        scope.assert.deepEqual(await execution.finish(), []);
        return scope.assert.collect();
    }),
    test('reports invalid JSON to the owning attempt once', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
        await execution.runAttempt(work, attempt, async function captureInvalidJson() {
            await scope.assert.rejects(async function () {
                return await execution.context.forProducer(producer).json(metadata, Number.NaN);
            }, {
                name: 'AttachmentOperationError'
            });
        });
        const errors = execution.takeErrors(owner);
        scope.assert.equal(errors.length, 1);
        scope.assert.equal(errors[0]?.subtype, 'artifact');
        scope.assert.deepEqual(recorded.operations, []);
        scope.assert.deepEqual(execution.takeErrors(owner), []);
        return scope.assert.collect();
    }),
    test(
        'keeps nested matching attempts active until the outer attempt ends',
        async function (scope) {
            const recorded = recordAttachmentExchange();
            const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
            await execution.runAttempt(work, attempt, async function outerAttempt() {
                await execution.runAttempt(
                    work,
                    attempt,
                    async function () {
                        return await execution.context.forProducer(producer).json(metadata, 1);
                    }
                );
                await execution.context.forProducer(producer).json(metadata, 2);
            });
            scope.assert.equal(
                recorded
                    .operations
                    .filter(function (operation) {
                        return operation.kind === 'close';
                    })
                    .length,
                2
            );
            scope.assert.deepEqual(execution.takeErrors(owner), []);
            return scope.assert.collect();
        }
    ),
    test('closes writers left open by an attempt', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
        await execution.runAttempt(work, attempt, async function leaveWriterOpen() {
            await execution.context.forProducer(producer).open({ ...metadata, kind: 'text' });
        });
        scope.assert.deepEqual(recorded.operations.slice(-1), [ { kind: 'close', writer: 1, reason: 'unclosed' } ]);
        scope.assert.equal(execution.takeErrors(owner).length, 1);
        scope.assert.deepEqual(await execution.finish(), []);
        return scope.assert.collect();
    }),
    test('closes run writers and reports their errors at finish', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
        await execution.context.forProducer(producer).open({ ...metadata, kind: 'text' });
        const errors = await execution.finish();
        scope.assert.equal(errors.length, 1);
        scope.assert.deepEqual(recorded.operations.slice(-1), [ { kind: 'close', writer: 1, reason: 'unclosed' } ]);
        scope.assert.deepEqual(await execution.finish(), []);
        return scope.assert.collect();
    }),
    test(
        'rejects writes after the owning attempt and integration run expire',
        async function (scope) {
            const recorded = recordAttachmentExchange();
            const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
            let escaped = async function missingWriter(): Promise<void> {
                throw new Error('Writer was not created.');
            };
            await execution.runAttempt(work, attempt, async function captureWriter() {
                const writer = await execution.context.forProducer(producer).open({ ...metadata, kind: 'text' });
                escaped = async function () {
                    await writer.write('late');
                };
                await writer.close();
            });
            await scope.assert.rejects(escaped, { message: 'Attachment escaped its test attempt.' });
            const errors = await execution.finish();
            scope.assert.equal(errors.length, 1);
            await scope.assert.rejects(async function () {
                return await execution.context.forProducer(producer).json(metadata, 1);
            }, {
                message: 'Attachment escaped its integration run.'
            });
            scope.assert.equal(execution.takeErrors({ kind: 'run' }).length, 1);
            return scope.assert.collect();
        }
    ),
    test('requires prepared artifacts to belong to an active attempt', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
        const prepared = execution.context.prepareForProducer(
            producer,
            { kind: 'attempt', work, attempt },
            'native',
            'attachment'
        );
        await scope.assert.rejects(async function () {
            return await prepared.json(metadata, 1);
        }, {
            message: 'Failure artifact escaped its test attempt.'
        });
        await execution.runAttempt(work, attempt, async function () {
            return await prepared.json(metadata, 1);
        });
        await scope.assert.rejects(async function () {
            return await prepared.json(metadata, 1);
        }, {
            message: 'Attachment escaped its test attempt.'
        });
        scope.assert.equal(execution.takeErrors({ kind: 'run' }).length, 2);
        scope.assert(assertPreparedOwner, recorded.operations[0]);
        return scope.assert.collect();
    }),
    test('registers resource consumers and failures', async function (scope) {
        const recorded = recordAttachmentExchange();
        const execution = createAttachmentExecution(recorded.exchange, defaultAttachmentLimits);
        await execution.registerResourceConsumers('service', [ work ]);
        await execution.markResourceFailure('service');
        scope.assert.deepEqual(recorded.operations, [
            { kind: 'resource-consumer', boundary: 'service', work },
            { kind: 'resource-failure', boundary: 'service' }
        ]);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid open replies',
        cases: [
            { response: { kind: 'written' }, message: 'Attachment open returned an invalid reply.' },
            { response: { kind: 'error', reason: 'denied', message: 'rejected' }, message: 'rejected' }
        ],
        caseTitle(expected) {
            return expected.response.kind;
        },
        async test(scope) {
            const expected = scope.parameters;

            const response: AttachmentResponse = expected.response.kind === 'error'
                ? { kind: 'error', reason: 'denied', message: 'rejected' }
                : { kind: 'written' };
            const execution = createAttachmentExecution(async function () {
                return response;
            }, defaultAttachmentLimits);
            await scope.assert.rejects(
                async function () {
                    return await execution.context.forProducer(producer).open({ ...metadata, kind: 'text' });
                },
                { message: expected.message }
            );
            const errors = await execution.finish();
            scope.assert.equal(errors.length, 1);
            return scope.assert.collect();
        }
    }),
    test('reports transport failures', async function (scope) {
        const execution = createAttachmentExecution(async function unavailable(): Promise<AttachmentResponse> {
            throw new Error('transport unavailable');
        }, defaultAttachmentLimits);
        await scope.assert.rejects(async function captureEvidence() {
            return await execution.context.forProducer(producer).json(metadata, 1);
        }, { message: 'transport unavailable' });
        const errors = await execution.finish();
        scope.assert.equal(errors.length, 1);
        return scope.assert.collect();
    })
]);
