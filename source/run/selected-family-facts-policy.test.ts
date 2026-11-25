import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { selectedFamilyCollection } from '../test-support/selected-family-collection.ts';
import { resolveSelectedFamilyFacts } from './selected-family-facts.ts';
import type { FamilyResolutionSource } from './family-catalog.ts';

const sources: readonly FamilyResolutionSource[] = [ {
    kind: 'config-file',
    configPath: '/project/overkill.config.ts',
    profile: 'unit'
}, { kind: 'module', module: { moduleUrl: 'file:///project/family.ts', exportName: 'family' } } ];
export const testNode = suite('selected family fact recollection', [
    table({
        title: 'recollects selected facts across host boundaries',
        cases: ([ 'worker-pool', 'supervised' ] as const).flatMap(function (model) {
            return sources.map(function (source) {
                return { model, source };
            });
        }),
        caseTitle({ model, source }) {
            return [ source.kind, model ].map(String).join(', ');
        },
        async test(scope) {
            const { model, source } = scope.parameters;

            const fixture = await selectedFamilyCollection(model, source, 'pass');
            const result = await resolveSelectedFamilyFacts(fixture.run, fixture.input);
            scope.assert.deepEqual<unknown, unknown>(result.facts.family, fixture.actual?.facts);
            scope.assert.deepEqual<unknown, unknown>(
                result.plan.kind === 'local' ? null : result.plan.collectedPlan.family,
                fixture.actual
            );
            scope.assert.equal(fixture.commands.length, 1);
            scope.assert.deepEqual<unknown, unknown>(
                fixture.commands[0]?.family?.selection,
                fixture.run.facts.cases.map(function (value) {
                    return value.workId;
                })
            );
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects recollection changes',
        cases: [ 'missing', 'preparation', 'checkpoint', 'error' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const scenario = scope.parameters;

            const source = sources[0];
            require.defined(source);
            const fixture = await selectedFamilyCollection('worker-pool', source, scenario);
            await scope.assert.rejects(async function () {
                await resolveSelectedFamilyFacts(fixture.run, fixture.input);
            }, {
                message: {
                    missing: 'Selected family collection did not return complete facts.',
                    preparation: 'Frozen family preparation changed; collect a new run.',
                    checkpoint: 'Frozen family work changed; collect a new run.',
                    error: 'Selected family collection did not return complete facts.'
                }[scenario]
            });
            scope.assert.equal(fixture.commands.length, 1);
            return scope.assert.collect();
        }
    }),
    test('uses facts from the live analysis child', async function (scope: TestScope) {
        const source = sources[0];
        scope.require.defined(source);
        const fixture = await selectedFamilyCollection('supervised', source, 'pass');
        const selection = fixture.run.facts.cases.map(function identity(value) {
            return value.workId;
        });
        const result = await resolveSelectedFamilyFacts(fixture.run, {
            ...fixture.input,
            async collectAnalysis(workIds) {
                scope.assert.deepEqual(workIds, selection);
                return { selected: workIds.length };
            }
        });
        scope.assert.deepEqual<unknown, unknown>(result.facts.family?.collection, { selected: selection.length });
        scope.assert.equal(fixture.commands.length, 0);
        return scope.assert.collect();
    }),
    test('does not recollect a family when no cases are selected', async function (scope: TestScope) {
        const source = sources[0];
        scope.require.defined(source);
        const fixture = await selectedFamilyCollection('worker-pool', source, 'pass');
        const run = { ...fixture.run, facts: { ...fixture.run.facts, cases: [] } };
        scope.assert.equal(await resolveSelectedFamilyFacts(run, fixture.input), run);
        scope.assert.deepEqual<unknown, unknown>(fixture.commands, []);
        return scope.assert.collect();
    })
]);
