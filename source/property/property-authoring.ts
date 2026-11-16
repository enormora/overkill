import {
    isBodyReference,
    isPropertyBodyAttachment,
    mapBodyReference,
    executableBody,
    withReferencedBodyFamily
} from '../engine/test-body.ts';
import type { BodyReference } from '../engine/body-reference.ts';
import {
    attachTestBodyFamily,
    readPropertyExecutionHost,
    createPropertyTestCase,
    type AssertionResult,
    type DefinitionLocations,
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
    createNestedPropertySession,
    type NestedPropertySession
} from './property-invocation.ts';
import type {
    NestedPropertyDeclaration,
    NormalizedPropertyInvocation,
    PropertyBody,
    PropertyCaseBody,
    PropertyDeclaration,
    PropertyDefinition
} from './property-definition.ts';

function ensurePropertyDefinition(value: unknown): void {
    if (
        typeof value !== 'object' || value === null ||
        typeof Reflect.get(value, 'test') !== 'function' && !isBodyReference(Reflect.get(value, 'test'))
    ) {
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

function hasTestFamily<Value>(
    definition: PropertyDefinition<Value>
): definition is PropertyDefinition<Value> & { readonly testFamily: 'integration'; } {
    return Object.hasOwn(definition, 'testFamily');
}

function declaredPropertyBody<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    locations: DefinitionLocations,
    body: PropertyDefinition<Value>['test']
): BodyReference | TestBody {
    function execution(test: PropertyBody<Value>): TestBody {
        return async function executeDeclaredProperty(scope) {
            return await runPropertyInvocation({ ...invocation, test }, {
                scope,
                signal: scope.signal,
                identity: 'declared-property',
                locations
            });
        };
    }
    return isBodyReference(body)
        ? mapBodyReference(body, function bindProperty(bound) {
            return execution(async function executeSample(value, sample) {
                return bound({ value, sample });
            });
        })
        : execution(body);
}

export function property<Value>(definition: PropertyDefinition<Value>): TestCase {
    ensurePropertyDefinition(definition);
    const family = hasTestFamily(definition) ? definition.testFamily : 'property';
    const ordinary = typeof definition.test === 'function' ? definition.test : function unavailableImplementation() {
        throw new TypeError('Property implementation was not admitted.');
    };
    const invocation = normalizePropertyInvocation({ ...definition, test: ordinary });
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
        test: ordinary,
        definitionLocations
    });
    const body = attachTestBodyFamily(
        declaredPropertyBody(invocation, definitionLocations, definition.test),
        { family, definition: declaration }
    );
    return createPropertyTestCase({
        ...hasTestFamily(definition) ? { testFamily: definition.testFamily } : {},
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
        if (!isPropertyBodyAttachment(attachment)) {
            throw new TypeError('withProperties() cannot wrap a body belonging to another test family.');
        }
        if (settings.length === 0) {
            return attachment;
        }
        if (!isPropertyBodyDefinition(attachment.definition)) {
            throw new TypeError('withProperties() settings require a property declaration.');
        }
        return {
            family: attachment.family,
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

async function runNestedPropertyBody(
    body: PropertyCaseBody,
    scope: TestScope,
    session: NestedPropertySession
): Promise<AssertionResult> {
    let completed = false;
    try {
        const result = await executableBody(body)({ ...scope, forall: session.forall });
        completed = true;
        return result;
    } finally {
        await session.finish();
        if (completed) {
            await session.validateTargets();
        }
    }
}

type InlinePropertyCaseBody = Extract<PropertyCaseBody, (scope: never) => unknown>;
type ReferencedPropertyCaseBody = BodyReference<
    Parameters<InlinePropertyCaseBody>[0],
    ReturnType<InlinePropertyCaseBody>
>;
export function withProperties(
    body: InlinePropertyCaseBody,
    ...settings: readonly [] | readonly [PropertySettings]
): TestBody;
export function withProperties(
    body: ReferencedPropertyCaseBody,
    ...settings: readonly [] | readonly [PropertySettings]
): BodyReference;
export function withProperties(
    body: InlinePropertyCaseBody | ReferencedPropertyCaseBody,
    ...settings: readonly [] | readonly [PropertySettings]
): BodyReference | TestBody;
export function withProperties(
    body: PropertyCaseBody,
    ...settings: readonly [] | readonly [PropertySettings]
): BodyReference | TestBody {
    if (isBodyReference(body)) {
        const mapped = mapBodyReference(body, function bound(source) {
            return withProperties(source, ...settings);
        });
        return withReferencedBodyFamily(mapped, propertyFamilyAttachment(body, settings));
    }
    if (typeof body !== 'function') {
        throw new TypeError('withProperties() requires a body function.');
    }
    return mapComposedResourceBody(
        body,
        async function executeNestedProperties(_underlying, scope) {
            const host = readPropertyExecutionHost(scope);
            const caseScope = { ...host.scope, ...scope };
            const session = createNestedPropertySession(caseScope);
            return await runNestedPropertyBody(body, caseScope, session);
        },
        'withProperties',
        propertyFamilyAttachment(body, settings)
    );
}
