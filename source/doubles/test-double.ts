type CallableSignature = (...arguments_: readonly never[]) => unknown;
type ConstructorSignature = new (...arguments_: readonly never[]) => unknown;
type PrimitiveValue = bigint | boolean | number | string | symbol | null | undefined;
type UnknownFunction<Result> = (...arguments_: readonly unknown[]) => Result;
type UnknownConstructor<Instance> = new (...arguments_: readonly unknown[]) => Instance;
type VoidReturn = ReturnType<() => void>;

type FixedReturnValue<SignatureOrValue> = SignatureOrValue extends CallableSignature ? ReturnType<SignatureOrValue>
    : SignatureOrValue;

type ReturnSignature<SignatureOrValue> = SignatureOrValue extends CallableSignature ? SignatureOrValue
    : UnknownFunction<SignatureOrValue>;

type CallableReturnArguments<Signature extends CallableSignature> = ReturnType<Signature> extends VoidReturn
    ? readonly [] | readonly [ReturnType<Signature>]
    : readonly [ReturnType<Signature>];

type ReturnArguments<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? CallableReturnArguments<SignatureOrValue>
    : readonly [FixedReturnValue<SignatureOrValue>];

type PromiseResolution<Value> = Value extends Promise<infer Resolved> ? Resolved
    : never;

type ResolvedValue<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? PromiseResolution<ReturnType<SignatureOrValue>>
    : Awaited<SignatureOrValue>;

type AsyncCallableSignature<Signature extends CallableSignature> = ReturnType<Signature> extends Promise<unknown>
    ? Signature
    : never;

type ResolvedSignature<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? AsyncCallableSignature<SignatureOrValue>
    : UnknownFunction<Promise<Awaited<SignatureOrValue>>>;

type NonPrimitiveInstance<SignatureOrInstance> = SignatureOrInstance extends PrimitiveValue ? never
    : SignatureOrInstance;

type ConstructInstance<SignatureOrInstance> = SignatureOrInstance extends ConstructorSignature
    ? InstanceType<SignatureOrInstance>
    : NonPrimitiveInstance<SignatureOrInstance>;

type ConstructSignature<SignatureOrInstance> = SignatureOrInstance extends ConstructorSignature ? SignatureOrInstance
    : UnknownConstructor<SignatureOrInstance>;

export type TestDouble<Signature> = Signature;

export type TestDoubleFactory = {
    (): TestDouble<UnknownFunction<unknown>>;
    readonly constructs: <SignatureOrInstance>(
        instance: ConstructInstance<SignatureOrInstance>
    ) => TestDouble<ConstructSignature<SignatureOrInstance>>;
    readonly rejects: {
        (reason: unknown): TestDouble<UnknownFunction<Promise<never>>>;
        <Signature extends CallableSignature>(
            reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
        ): TestDouble<Signature>;
    };
    readonly resolves: <SignatureOrValue>(
        value: ResolvedValue<SignatureOrValue>
    ) => TestDouble<ResolvedSignature<SignatureOrValue>>;
    readonly returns: <SignatureOrValue>(
        ...value: ReturnArguments<SignatureOrValue>
    ) => TestDouble<ReturnSignature<SignatureOrValue>>;
    readonly throws: {
        (thrown: unknown): TestDouble<UnknownFunction<never>>;
        <Signature extends CallableSignature>(
            thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
        ): TestDouble<Signature>;
    };
};

function assertCallableDouble<ReturnValue>(value: unknown): asserts value is UnknownFunction<ReturnValue> {
    if (typeof value !== 'function') {
        throw new TypeError('Expected callable double factory to create a function.');
    }
}

function createCallableDouble<ReturnValue>(answer: () => ReturnValue): UnknownFunction<ReturnValue> {
    const candidate: unknown = new Proxy(function TestDoubleCallable() {
        throw new TypeError('test double callable target should not be reached.');
    }, {
        apply(target) {
            if (typeof target !== 'function') {
                throw new TypeError('Expected callable double target to be a function.');
            }

            return answer();
        },
        construct() {
            throw new TypeError('test double is not a constructor.');
        }
    });

    assertCallableDouble<ReturnValue>(candidate);

    return candidate;
}

function isConstructorInstance(value: unknown): boolean {
    return typeof value === 'object' && value !== null || typeof value === 'function';
}

function assertConstructorDouble<Instance>(value: unknown): asserts value is UnknownConstructor<Instance> {
    if (typeof value !== 'function') {
        throw new TypeError('Expected constructor double factory to create a function.');
    }
}

function createConstructorDouble<Instance>(instance: Instance): UnknownConstructor<Instance> {
    const candidate: unknown = new Proxy(function TestDoubleConstructor() {
        throw new TypeError('Class constructor TestDoubleConstructor cannot be invoked without new.');
    }, {
        apply() {
            throw new TypeError('Class constructor TestDoubleConstructor cannot be invoked without new.');
        },
        construct() {
            return new Object(instance);
        }
    });

    assertConstructorDouble<Instance>(candidate);

    return candidate;
}

function createUntypedDouble(...configuration: readonly unknown[]): TestDouble<UnknownFunction<unknown>> {
    if (configuration.length > 0) {
        throw new TypeError('testDouble() does not accept configuration yet.');
    }

    return createCallableDouble(function returnUnknown() {
        return undefined;
    });
}

function createConstructingDouble<SignatureOrInstance>(
    instance: ConstructInstance<SignatureOrInstance>
): TestDouble<ConstructSignature<SignatureOrInstance>>;
function createConstructingDouble(instance: unknown): unknown {
    if (!isConstructorInstance(instance)) {
        throw new TypeError('testDouble.constructs() requires an object instance.');
    }

    return createConstructorDouble(instance);
}

function createRejectingDouble(reason: unknown): TestDouble<UnknownFunction<Promise<never>>>;
function createRejectingDouble<Signature extends CallableSignature>(
    reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
): TestDouble<Signature>;
function createRejectingDouble(reason: unknown): UnknownFunction<Promise<never>> {
    return createCallableDouble(async function rejectDouble() {
        throw reason;
    });
}

function createResolvingDouble<SignatureOrValue>(
    value: ResolvedValue<SignatureOrValue>
): TestDouble<ResolvedSignature<SignatureOrValue>>;
function createResolvingDouble(value: unknown): unknown {
    return createCallableDouble(async function resolveDouble() {
        return value;
    });
}

function createReturningDouble<SignatureOrValue>(
    ...value: ReturnArguments<SignatureOrValue>
): TestDouble<ReturnSignature<SignatureOrValue>>;
function createReturningDouble(...value: readonly unknown[]): UnknownFunction<unknown> {
    return createCallableDouble(function returnValue() {
        return value[0];
    });
}

function createThrowingDouble(thrown: unknown): TestDouble<UnknownFunction<never>>;
function createThrowingDouble<Signature extends CallableSignature>(
    thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
): TestDouble<Signature>;
function createThrowingDouble(thrown: unknown): UnknownFunction<never> {
    return createCallableDouble(function throwDouble() {
        throw thrown;
    });
}

export const testDouble: TestDoubleFactory = Object.assign(createUntypedDouble, {
    constructs: createConstructingDouble,
    rejects: createRejectingDouble,
    resolves: createResolvingDouble,
    returns: createReturningDouble,
    throws: createThrowingDouble
});
