import {
    attachTestBodyFamily,
    readPropertyExecutionHost,
    createPropertyTestCase,
    type PropertySettings,
    type PropertySettingsDeclaration,
    type TestBodyFamilyAttachment,
    readTestBodyFamily,
    type TestBody,
    type TestScope,
    type TestCase
} from '../packages/engine/engine.entry-point.ts';
import {
    assertionBodyForActiveMacro,
    definitionLocationsForAuthoringCall
} from '../packages/test/authoring-source-locations.ts';
import { mapComposedResourceBody } from '../packages/test/resource-wrapper-composition.ts';
import { isPropertyBodyDefinition } from '../engine/property-node.ts';
import {
    normalizePropertyInvocation,
    runPropertyInvocation,
    createNestedPropertySession
} from './property-invocation.ts';
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

function propertySettingsDeclaration(settings: unknown): PropertySettingsDeclaration {
    const snapshot = typeof settings === 'object' && settings !== null && !Array.isArray(settings)
        ? Object.freeze({ ...settings })
        : settings;
    return Object.freeze({ kind: 'settings', settings: snapshot });
}

function hasPropertySettings<Value>(
    definition: PropertyDefinition<Value>
): definition is PropertyDefinition<Value> & { readonly settings: PropertySettings; } {
    return Object.hasOwn(definition, 'settings');
}

export function property<Value>(definition: PropertyDefinition<Value>): TestCase {
    ensurePropertyDefinition(definition);
    const invocation = normalizePropertyInvocation(definition);
    const definitionLocations = definitionLocationsForAuthoringCall();
    const declaration: PropertyDeclaration<Value> = Object.freeze<PropertyDeclaration<Value>>({
        kind: 'property',
        settingsDeclarations: Object.freeze([
            hasPropertySettings(definition)
                ? propertySettingsDeclaration(definition.settings)
                : { kind: 'profile-default' }
        ]),
        examples: invocation.examples,
        generator: invocation.generator,
        test: definition.test,
        definitionLocations
    });
    const body = attachTestBodyFamily(async function executeDeclaredProperty(scope: TestScope) {
        return await runPropertyInvocation(invocation, {
            scope,
            signal: scope.signal,
            identity: 'declared-property',
            locations: definitionLocations
        });
    }, { family: 'property', definition: declaration });
    return createPropertyTestCase({
        definition: declaration,
        annotations: {},
        controls: {},
        definitionLocations,
        title: definition.title,
        body: assertionBodyForActiveMacro(body)
    });
}

function propertyFamilyAttachment(
    body: PropertyCaseBody,
    settings: readonly [] | readonly [PropertySettings]
): TestBodyFamilyAttachment<unknown> {
    const attachment = readTestBodyFamily(body);
    if (attachment !== null) {
        if (attachment.family !== 'property') {
            throw new TypeError('withProperties() cannot wrap a body belonging to another test family.');
        }
        if (settings.length === 0) {
            return attachment;
        }
        if (!isPropertyBodyDefinition(attachment.definition)) {
            throw new TypeError('withProperties() settings require a property declaration.');
        }
        return {
            family: 'property',
            definition: Object.freeze({
                ...attachment.definition,
                settingsDeclarations: Object.freeze([
                    ...attachment.definition.settingsDeclarations,
                    propertySettingsDeclaration(settings[0])
                ])
            })
        };
    }
    return {
        family: 'property',
        definition: Object.freeze<NestedPropertyDeclaration>({
            kind: 'nested',
            body,
            definitionLocations: definitionLocationsForAuthoringCall(),
            settingsDeclarations: Object.freeze([
                settings.length === 0 ? { kind: 'profile-default' } : propertySettingsDeclaration(settings[0])
            ])
        })
    };
}

export function withProperties(
    body: PropertyCaseBody,
    ...settings: readonly [] | readonly [PropertySettings]
): TestBody {
    if (typeof body !== 'function') {
        throw new TypeError('withProperties() requires a body function.');
    }
    return mapComposedResourceBody(
        body,
        async function executeNestedProperties(_underlying, scope) {
            const host = readPropertyExecutionHost(scope);
            const caseScope = { ...host.scope, ...scope };
            const session = createNestedPropertySession(caseScope);
            try {
                return await body({ ...caseScope, forall: session.forall });
            } finally {
                await session.finish();
            }
        },
        'withProperties',
        propertyFamilyAttachment(body, settings)
    );
}
