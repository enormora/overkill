import { defineMacro, suite, test } from '../authoring/test-node-authoring.ts';
import type { AssertionResult, TestCase, TestScope } from '../packages/engine/engine.entry-point.ts';
import type {
    ConfigDefinition,
    ConfigGeneration,
    ConfigTests,
    ConfigSource,
    ConfigSelectionSet
} from './config-definition.ts';
import { configNames, validateConfigDefinition } from './config-validation.ts';
import { inventoryCheck, fileCheck } from './config-checks.ts';
import { fixtureCheck } from './config-fixtures.ts';
import { assertConfigOperation } from './config-assertions.ts';
import { configProperty } from './config-properties.ts';
import { generationContracts } from './config-generation.ts';
import type { ConfigSeeds } from './config-seeds.ts';

function configCase(
    title: string,
    label: string,
    run: (scope: TestScope) => Promise<AssertionResult | null>
): TestCase {
    return test(title, async function check(scope) {
        const outcome = await assertConfigOperation(scope, label, async function operation() {
            return await run(scope);
        });
        if (outcome.kind === 'passed' && outcome.value !== null) {
            return outcome.value;
        }
        return scope.assert.collect();
    });
}

function selectedConfigs(
    definition: ConfigDefinition<string>,
    selection: ConfigSelectionSet<string>
): readonly (readonly [string, ConfigSource])[] {
    const names = configNames(Object.keys(definition.configs), selection);
    return Object.entries(definition.configs).filter(function selected([ name ]) {
        return names.includes(name);
    });
}

function propertySeeds(
    definition: ConfigDefinition<string>,
    generation: ConfigGeneration<string>,
    name: string
): ConfigSeeds {
    const sources = definition.fixtures.filter(function eligible(fixture) {
        if (fixture.expect.kind !== 'custom' && fixture.expect.diagnostics.kind === 'parse-failure') {
            return false;
        }
        const selected = configNames(Object.keys(definition.configs), fixture.configs);
        return selected.includes(name) &&
            (generation.generator.kind === 'custom' || fixture.source.filename === generation.generator.filename);
    });
    return { project: definition.project, sources };
}

function configurationChecks(definition: ConfigDefinition<string>): readonly TestCase[] {
    const inventories = definition.inventories.flatMap(function inventory(entry) {
        return selectedConfigs(definition, entry.configs).map(function variant([ name, source ]) {
            return configCase(`${entry.title}: ${name}`, 'Rule inventory', async function run(scope) {
                await inventoryCheck(definition, source, entry, scope);
                return null;
            });
        });
    });
    const files = definition.files.flatMap(function file(entry) {
        return selectedConfigs(definition, entry.configs).map(function variant([ name, source ]) {
            return configCase(`${entry.title}: ${name}`, 'Effective configuration', async function run(scope) {
                await fileCheck(definition, source, entry, scope);
                return null;
            });
        });
    });
    return [ ...inventories, ...files ];
}

function configurationFixtures(definition: ConfigDefinition<string>): readonly TestCase[] {
    return definition.fixtures.flatMap(function fixture(entry) {
        return selectedConfigs(definition, entry.configs).map(function variant([ name, source ]) {
            return configCase(`${entry.title}: ${name}`, 'Config fixture', async function run(scope) {
                return await fixtureCheck(definition, source, entry, scope);
            });
        });
    });
}

function configurationProperties(definition: ConfigDefinition<string>): readonly TestCase[] {
    return definition.generation.flatMap(function target(entry) {
        return selectedConfigs(definition, entry.configs).flatMap(function variant([ name, source ]) {
            const seeds = propertySeeds(definition, entry, name);
            return generationContracts(entry).map(function contract(value) {
                return configProperty({ generation: entry, source, contract: value }, name, seeds);
            });
        });
    });
}

export function defineConfigTests<const Name extends string>(definition: ConfigDefinition<Name>): ConfigTests {
    validateConfigDefinition(definition);
    return {
        checks: defineMacro(function checks() {
            return suite(definition.name, configurationChecks(definition));
        }),
        fixtures: defineMacro(function fixtures() {
            return suite(definition.name, configurationFixtures(definition));
        }),
        properties: defineMacro(function properties() {
            return suite(definition.name, configurationProperties(definition));
        })
    };
}
