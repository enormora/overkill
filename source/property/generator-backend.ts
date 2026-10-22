import { Arbitrary, Stream, type Random, type Value } from 'fast-check';

export type GeneratorContext = {
    readonly maxSize: number;
    readonly maxDepth: number;
    readonly consumeWork: () => void;
    readonly exhaustDomain: () => never;
};

// eslint-disable-next-line restricted-syntax/no-class-declaration -- fast-check's Arbitrary extension point requires inheritance.
export class DeferredArbitrary<Input> extends Arbitrary<Input> {
    private readonly build: () => Arbitrary<Input>;
    private readonly context: GeneratorContext;
    private domain: Arbitrary<Input> | null = null;

    public constructor(build: () => Arbitrary<Input>, context: GeneratorContext) {
        super();
        this.build = build;
        this.context = context;
    }

    public generate(random: Random, bias: number | undefined): Value<Input> {
        return this.resolve().generate(random, bias);
    }

    public canShrinkWithoutContext(value: unknown): value is Input {
        return this.resolve().canShrinkWithoutContext(value);
    }

    public shrink(value: Input, context: unknown): Stream<Value<Input>> {
        const domain = this.resolve();
        const { consumeWork } = this.context;
        return new Stream((function* boundedCandidates() {
            consumeWork();
            const candidates = domain.shrink(value, context);
            function nextCandidate(): IteratorResult<Value<Input>> {
                consumeWork();
                return candidates.next();
            }
            for (let candidate = nextCandidate(); candidate.done !== true; candidate = nextCandidate()) {
                yield candidate.value;
            }
        })());
    }

    private resolve(): Arbitrary<Input> {
        this.context.consumeWork();
        if (this.domain === null) {
            this.domain = this.build();
        }
        return this.domain;
    }
}
