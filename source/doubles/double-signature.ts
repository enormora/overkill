export type CallArguments<Signature> = Signature extends (...arguments_: infer Arguments) => unknown ? Arguments
    : never;

export type ConstructionArguments<Signature> = Signature extends new (...arguments_: infer Arguments) => unknown
    ? Arguments
    : never;

export type CallReturn<Signature> = Signature extends (...arguments_: readonly never[]) => infer ReturnValue
    ? ReturnValue
    : never;

export type ConstructionInstance<Signature> = Signature extends new (
    ...arguments_: readonly never[]
) => infer Instance ? Instance
    : never;
