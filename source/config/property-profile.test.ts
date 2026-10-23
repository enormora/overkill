import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from './config.ts';
import { propertyProfileSchema } from './schema.ts';
import { copyConfig } from './snapshot.ts';
import { defaultPropertyPolicy } from './property-policy.ts';
import { validateNormalizedConfig } from './validation.ts';

const files = { include: [ 'source/**/*.property.ts' ] } as const;

export const testNode = suite('property profile', [
    test('validates normalized policy and rejects added capability fields', function (scope) {
        const config = normalizeConfig({ profiles: { laws: { testFamily: 'property', files } } });
        validateNormalizedConfig(config);
        const profile = config.profiles.laws;
        if (profile?.testFamily !== 'property') {
            throw new TypeError('Expected a property profile.');
        }
        const invalid = { ...config, profiles: { laws: { ...profile, capabilities: {} } } };
        scope.assert.throws(function validateAddedCapabilityFields() {
            validateNormalizedConfig(invalid);
        }, { message: 'Property profiles cannot configure additional fields.' });
        return scope.assert.collect();
    }),
    test('rejects invalid normalized exploration budgets', function (scope) {
        const config = normalizeConfig({ profiles: { laws: { testFamily: 'property', files } } });
        const profile = config.profiles.laws;
        if (profile?.testFamily !== 'property') {
            throw new TypeError('Expected a property profile.');
        }
        const invalid = {
            ...config,
            profiles: { laws: { ...profile, property: { ...profile.property, maxWork: 0 } } }
        };
        scope.assert.throws(function validateInvalidWorkBudget() {
            validateNormalizedConfig(invalid);
        }, { message: /maxWork/ });
        return scope.assert.collect();
    }),
    test('normalizes property defaults without adding coverage or attachments', function (scope) {
        const config = normalizeConfig({ profiles: { laws: { testFamily: 'property', files } } });
        const profile = config.profiles.laws;
        if (profile?.testFamily !== 'property') {
            throw new TypeError('Expected a property profile.');
        }
        scope.assert.deepEqual(profile.property, defaultPropertyPolicy);
        scope.assert.deepEqual(profile.timeouts, {
            collectionMilliseconds: 2000,
            softMilliseconds: 1000,
            hardMilliseconds: 2000
        });
        scope.assert.deepEqual(profile.execution, {
            maxConcurrency: 5,
            processModel: 'supervised-process',
            scheduling: 'concurrent'
        });
        scope.assert.false(Object.hasOwn(profile, 'coverage'));
        scope.assert.false(Object.hasOwn(profile, 'attachments'));

        return scope.assert.collect();
    }),
    test('copies normalized property policy independently', function (scope) {
        const config = normalizeConfig({ profiles: { laws: { testFamily: 'property', files } } });
        const copied = copyConfig(config);
        scope.assert.deepEqual(copied, config);
        scope.assert.notEqual(copied.profiles.laws, config.profiles.laws);
        return scope.assert.collect();
    }),
    test('supports named property profiles and finite overrides above defaults', function (scope) {
        const config = normalizeConfig({
            profiles: {
                laws: {
                    testFamily: 'property',
                    files,
                    property: { newTrials: 200, maxWork: 20_000, maxShrinkWork: 0 },
                    execution: { processModel: 'in-process', scheduling: 'serial' }
                }
            }
        });
        const profile = config.profiles.laws;
        if (profile?.testFamily !== 'property') {
            throw new TypeError('Expected a property profile.');
        }
        scope.assert.equal(profile.property.newTrials, 200);
        scope.assert.equal(profile.property.maxWork, 20_000);
        scope.assert.equal(profile.property.maxShrinkWork, 0);
        scope.assert.equal(profile.execution.processModel, 'in-process');
        return scope.assert.collect();
    }),
    test('rejects missing discovery and family-incompatible configuration', function (scope) {
        for (
            const extra of [ { coverage: {} }, { retries: {} }, { attachments: {} }, { capabilities: {} }, {
                execution: { processModel: 'worker-pool' }
            } ]
        ) {
            scope.assert.false(propertyProfileSchema.safeParse({ testFamily: 'property', files, ...extra }).success);
        }
        scope.assert.false(propertyProfileSchema.safeParse({ testFamily: 'property' }).success);
        return scope.assert.collect();
    }),
    test('rejects invalid work limits and permits bounded zero limits', function (scope) {
        for (const value of [ 0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1 ]) {
            scope.assert.false(
                propertyProfileSchema.safeParse({ testFamily: 'property', files, property: { maxWork: value } }).success
            );
        }
        scope.assert.false(
            propertyProfileSchema.safeParse({ testFamily: 'property', files, property: { unknown: 1 } }).success
        );
        scope.assert.true(
            propertyProfileSchema
                .safeParse({
                    testFamily: 'property',
                    files,
                    property: {
                        maxSize: 0,
                        maxDepth: 0,
                        maxAutomaticEdges: 0,
                        maxExhaustiveValues: 0,
                        maxShrinkWork: 0,
                        maxWork: 1
                    }
                })
                .success
        );
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
