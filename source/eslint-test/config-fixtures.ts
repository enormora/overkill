import assert from 'node:assert/strict';
import type { AssertionResult, TestScope } from '../packages/engine/engine.entry-point.ts';
import type {
    ConfigContext,
    ConfigDefinition,
    ConfigFixture,
    ConfigFixtureExpectation,
    ConfigObservation,
    ConfigSource
} from './config-definition.ts';
import { configLayers, inConfigProject, projectText } from './config-project.ts';
import { observeConfigSource, stableObservation } from './config-execution.ts';
import { fatalDiagnostics } from './diagnostic-expectations.ts';
import { checkConfigDiagnostics } from './config-expectations.ts';

async function customFixtureResult(
    expected: Extract<ConfigFixtureExpectation, { readonly kind: 'custom'; }>,
    observation: ConfigObservation,
    scope: TestScope
): Promise<AssertionResult> {
    const result = await expected.check(observation, scope);
    assert.notEqual(result, undefined, 'Custom checks must return an assertion result.');
    assert.notEqual(result, null, 'Custom checks must return an assertion result.');
    return result;
}

async function checkFixtureObservation(
    context: ConfigContext,
    observation: ConfigObservation,
    expected: ConfigFixtureExpectation,
    scope: TestScope
): Promise<AssertionResult | null> {
    if (expected.kind === 'custom') {
        return await customFixtureResult(expected, stableObservation(observation, context.root), scope);
    }
    checkConfigDiagnostics(observation.messages, expected.diagnostics);
    if (expected.kind === 'fix') {
        const output = expected.output.kind === 'text'
            ? expected.output.text
            : await projectText(context, expected.output.filename);
        assert.deepEqual(fatalDiagnostics(observation.fixedMessages), [], 'Autofix produced a parser failure.');
        assert.equal(observation.output, output, 'Autofix output differs.');
    }
    return null;
}

export async function fixtureCheck(
    definition: ConfigDefinition<string>,
    source: ConfigSource,
    fixture: ConfigFixture<string>,
    scope: TestScope
): Promise<AssertionResult | null> {
    return await inConfigProject(definition.project, scope.signal, async function check(context) {
        const configs = await configLayers(source, context);
        const { filename } = fixture.source;
        const code = fixture.source.kind === 'inline' ? fixture.source.code : await projectText(context, filename);
        const observation = await observeConfigSource(
            {
                context,
                configs,
                materialized: definition.project.kind === 'virtual'
            },
            { filename, code },
            fixture.expect.kind !== 'lint'
        );
        return await checkFixtureObservation(context, observation, fixture.expect, scope);
    });
}
