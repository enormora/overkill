import {
    attachTestBodyResourceAttachments,
    captureSourceLocation,
    forwardAssertionSourceLocations,
    hasTestBodyResourceAttachments,
    readTestBodyResourceAttachments,
    unknownSourceLocation,
    type NonEmptyReadonlyArray,
    type ResolvableSourceLocation,
    type TestBody,
    type TestScope,
    type ThrowingTestBody
} from '../engine/engine.entry-point.ts';

type DefinitionLocationCapture = 'disabled' | 'enabled';

type ParameterizedTestBody<Data> = (
    scope: TestScope,
    data: Data
) => ReturnType<TestBody>;

type MacroDefinitionContext = {
    readonly locations: () => readonly ResolvableSourceLocation[];
    readonly run: <Result>(
        locations: NonEmptyReadonlyArray<ResolvableSourceLocation>,
        body: () => Result
    ) => Result;
};

const macroDefinitionContextKey = Symbol.for('@overkill-dev/macro-definition-context');
const definitionLocationCaptureStackKey = Symbol.for('@overkill-dev/definition-location-capture-stack');

function isMacroDefinitionContext(value: unknown): value is MacroDefinitionContext {
    return typeof value === 'object' && value !== null &&
        Object.hasOwn(value, 'locations') && typeof Reflect.get(value, 'locations') === 'function' &&
        Object.hasOwn(value, 'run') && typeof Reflect.get(value, 'run') === 'function';
}

function createMacroDefinitionContext(): MacroDefinitionContext {
    const locations: NonEmptyReadonlyArray<ResolvableSourceLocation>[] = [];

    return {
        locations() {
            return locations.at(-1) ?? [];
        },
        run(sourceLocations, body) {
            locations.push(sourceLocations);
            try {
                return body();
            } finally {
                locations.pop();
            }
        }
    };
}

function macroDefinitionContext(): MacroDefinitionContext {
    const existing: unknown = Reflect.get(globalThis, macroDefinitionContextKey);

    if (isMacroDefinitionContext(existing)) {
        return existing;
    }

    const context = createMacroDefinitionContext();
    Reflect.set(globalThis, macroDefinitionContextKey, context);

    return context;
}

function isDefinitionLocationCapture(value: unknown): value is DefinitionLocationCapture {
    return value === 'disabled' || value === 'enabled';
}

function isDefinitionLocationCaptureStack(value: unknown): value is DefinitionLocationCapture[] {
    return Array.isArray(value) && value.every(isDefinitionLocationCapture);
}

function activeDefinitionLocationCapture(): DefinitionLocationCapture {
    const captures: unknown = Reflect.get(globalThis, definitionLocationCaptureStackKey);

    if (!isDefinitionLocationCaptureStack(captures)) {
        return 'enabled';
    }

    return captures.at(-1) ?? 'enabled';
}

function captureDefinitionLocation(): ResolvableSourceLocation {
    return activeDefinitionLocationCapture() === 'enabled' ? captureSourceLocation() : unknownSourceLocation;
}

export function activeMacroSourceLocations(): readonly ResolvableSourceLocation[] {
    return macroDefinitionContext().locations();
}

function sourceLocationsWithTrailingLocation<Location>(
    sourceLocations: readonly Location[],
    location: Location
): NonEmptyReadonlyArray<Location> {
    const firstLocation = sourceLocations[0];

    return firstLocation === undefined
        ? [ location ]
        : [ firstLocation, ...sourceLocations.slice(1), location ];
}

export function runWithForwardedSourceLocations<Result>(
    sourceLocations: readonly ResolvableSourceLocation[],
    body: () => Result
): Result {
    const firstLocation = sourceLocations[0];

    return firstLocation === undefined
        ? body()
        : forwardAssertionSourceLocations([ firstLocation, ...sourceLocations.slice(1) ], body);
}

export function definitionLocationsForAuthoringCall(): NonEmptyReadonlyArray<ResolvableSourceLocation> {
    return sourceLocationsWithTrailingLocation(
        activeMacroSourceLocations(),
        captureDefinitionLocation()
    );
}

function forwardResourceAttachments<Scope, Result>(
    sourceBody: (scope: Scope) => Result,
    forwardedBody: (scope: Scope) => Result
): (scope: Scope) => Result {
    return hasTestBodyResourceAttachments(sourceBody)
        ? attachTestBodyResourceAttachments(forwardedBody, readTestBodyResourceAttachments(sourceBody))
        : forwardedBody;
}

export function assertionBodyForActiveMacro(body: TestBody): TestBody {
    const sourceLocations = activeMacroSourceLocations();

    if (sourceLocations.length === 0) {
        return body;
    }

    return forwardResourceAttachments(body, async function runMacroGeneratedTestBody(scope) {
        return await runWithForwardedSourceLocations(sourceLocations, async function runBody() {
            return await body(scope);
        });
    });
}

export function throwingBodyForActiveMacro(body: ThrowingTestBody): ThrowingTestBody {
    const sourceLocations = activeMacroSourceLocations();

    if (sourceLocations.length === 0) {
        return body;
    }

    return forwardResourceAttachments(body, async function runMacroGeneratedThrowingTestBody(scope) {
        await runWithForwardedSourceLocations(sourceLocations, async function runBody() {
            await body(scope);
        });
    });
}

export function runMacroWithDefinitionLocations<Result>(body: () => Result): Result {
    return macroDefinitionContext().run(definitionLocationsForAuthoringCall(), body);
}

export function defineParameterizedTestBodyFactory<Data>(
    body: ParameterizedTestBody<Data>
): (data: Data) => TestBody {
    return function createParameterizedTestBody(data) {
        const sourceLocations: NonEmptyReadonlyArray<ResolvableSourceLocation> = [ captureSourceLocation() ];

        return async function runParameterizedTestBody(scope) {
            return forwardAssertionSourceLocations(sourceLocations, async function runBody() {
                return body(scope, data);
            });
        };
    };
}
