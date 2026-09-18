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

const activeMacroDefinitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>[] = [];
const definitionLocationCaptureStackKey = Symbol.for('@overkill-dev/definition-location-capture-stack');

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
    return activeMacroDefinitionLocations.at(-1) ?? [];
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
    const definitionLocations = definitionLocationsForAuthoringCall();

    activeMacroDefinitionLocations.push(definitionLocations);
    try {
        return body();
    } finally {
        activeMacroDefinitionLocations.pop();
    }
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
