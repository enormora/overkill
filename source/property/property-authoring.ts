import {
    attachTestBodyFamily,
    createTestCase,
    readTestBodyFamily,
    type TestBody,
    type TestCase
} from '../packages/engine/engine.entry-point.ts';
import {
    assertionBodyForActiveMacro,
    definitionLocationsForAuthoringCall
} from '../packages/test/authoring-source-locations.ts';
import { mapComposedResourceBody } from '../packages/test/resource-wrapper-composition.ts';
import { ensureGenerator } from './generator.ts';
import type {
    NestedPropertyDeclaration,
    PropertyCaseBody,
    PropertyDeclaration,
    PropertyDefinition
} from './property-definition.ts';

function ensurePropertyDefinition(value: unknown): void {
    if (typeof value !== 'object' || value === null || typeof Reflect.get(value, 'test') !== 'function') {
        throw new TypeError('property() requires ({ title, generator, test }).');
    }
}

export function property<Value>(definition: PropertyDefinition<Value>): TestCase {
    ensurePropertyDefinition(definition);
    ensureGenerator(definition.generator);
    const definitionLocations = definitionLocationsForAuthoringCall();
    const declaration: PropertyDeclaration<Value> = Object.freeze({
        kind: 'property',
        generator: definition.generator,
        test: definition.test,
        definitionLocations
    });
    const body = attachTestBodyFamily(function unavailablePropertyExecution() {
        throw new TypeError(
            'Property execution is not available. Property policy and generator execution are required.'
        );
    }, { family: 'property', definition: declaration });
    return createTestCase({
        annotations: {},
        controls: {},
        definitionLocations,
        title: definition.title,
        body: assertionBodyForActiveMacro(body)
    });
}

export function withProperties(body: PropertyCaseBody): TestBody {
    if (typeof body !== 'function') {
        throw new TypeError('withProperties() requires a body function.');
    }
    const attachment = readTestBodyFamily(body);
    if (attachment !== null && attachment.family !== 'property') {
        throw new TypeError('withProperties() cannot wrap a body belonging to another test family.');
    }
    const declaration: NestedPropertyDeclaration = Object.freeze({
        kind: 'nested',
        body,
        definitionLocations: definitionLocationsForAuthoringCall()
    });
    const envelope = mapComposedResourceBody(body, async function rejectNestedPropertyExecution() {
        throw new TypeError(
            'Property execution is not available. Property policy and generator execution are required.'
        );
    }, 'withProperties');
    return attachment === null
        ? attachTestBodyFamily(envelope, { family: 'property', definition: declaration })
        : envelope;
}
