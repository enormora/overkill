import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { property } from './property-authoring.ts';
import { defineCodec } from './property-codec.ts';
import { gen } from './generators.ts';

export const testNode = suite('property codec execution', [
    test('decoder errors prevent trial execution', async function (scope) {
        let bodies = 0;
        const codec = defineCodec({
            name: 'broken',
            version: 1,
            previousDecoders: [],
            encode(value: number) {
                return value;
            },
            decode(): number {
                throw new Error('broken decoder');
            }
        });
        const node = property({
            title: 'broken codec',
            generator: gen.constant<number>(1).withCodec(codec),
            test(value, sample) {
                bodies += value;
                sample.assert.true(true);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(bodies, 0);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.includes(JSON.stringify(result), 'PropertyCodecError');
        return scope.assert.collect();
    }),
    test('decoder errors after failure retain the assertion and invalidate its capture', async function (scope) {
        let decodes = 0;
        const codec = defineCodec({
            name: 'later-broken',
            version: 1,
            previousDecoders: [],
            encode(value: number) {
                return value;
            },
            decode(value: unknown): number {
                decodes += 1;
                if (decodes > 1) {
                    throw new Error('confirmation codec failed');
                }
                return Number(value);
            }
        });
        const node = property({
            title: 'preserved assertion',
            generator: gen.constant<number>(1).withCodec(codec),
            test(value, sample) {
                sample.assert.equal(value, 2);
                return sample.assert.collect();
            }
        });
        const result = await executePropertyNode(node, propertyExecutionDefaults);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result), 'codec-error');
        scope.assert.includes(JSON.stringify(result), 'Expected values to be equal');
        return scope.assert.collect();
    })
]);
