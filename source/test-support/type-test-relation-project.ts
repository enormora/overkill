export const relationSource = `
export type AnyActual = any;
export type AnyExpected = any;
export type NeverActual = never;
export type NeverExpected = never;
export type UnknownActual = unknown;
export type UnknownExpected = unknown;
export type AnyUnknownActual = any;
export type AnyUnknownExpected = unknown;
export type NeverStringActual = never;
export type NeverStringExpected = string;
export type LiteralActual = 'hello';
export type LiteralExpected = string;
export type UnionActual = string | number;
export type UnionExpected = number | string;
export type IntersectionActual = { a: string } & { b: number };
export type IntersectionExpected = { a: string; b: number };
export type OptionalActual = { a?: string };
export type OptionalExpected = { a: string | undefined };
export type ReadonlyActual = { readonly a: string };
export type ReadonlyExpected = { a: string };
declare class First { private identity: string; }
declare class Second { private identity: string; }
export type NominalActual = First;
export type NominalExpected = Second;
declare class ProtectedFirst { protected identity: string; }
declare class ProtectedSecond { protected identity: string; }
export type ProtectedActual = ProtectedFirst;
export type ProtectedExpected = ProtectedSecond;
declare const first: unique symbol;
declare const second: unique symbol;
export type SymbolActual = typeof first;
export type SymbolExpected = typeof second;
export type ParameterActual = (a: string) => number;
export type ParameterExpected = (b: string) => number;
export type GenericActual = <A>(a: A) => A;
export type GenericExpected = <B>(b: B) => B;
export type ThisActual = (this: string) => void;
export type ThisExpected = (this: number) => void;
export type RestActual = (...args: string[]) => void;
export type RestExpected = (arg: string) => void;
export type OptionalParameterActual = (arg?: string) => void;
export type OptionalParameterExpected = (arg: string) => void;
export type ConstraintActual = <T extends string>(arg: T) => T;
export type ConstraintExpected = <T extends number>(arg: T) => T;
export type DefaultActual = <T = string>() => T;
export type DefaultExpected = <T = number>() => T;
export type ConstActual = <const T>(arg: T) => T;
export type ConstExpected = <T>(arg: T) => T;
export type NoInferActual = <T>(arg: T, other: NoInfer<T>) => T;
export type NoInferExpected = <T>(arg: T, other: T) => T;
export type OverloadActual = { (arg: string): string; (arg: number): number };
export type OverloadExpected = { (arg: number): number; (arg: string): string };
export type RecursiveActual = { next: RecursiveActual | null };
export type RecursiveExpected = { next: RecursiveExpected | null };
export type SymbolicActual<T> = T extends string ? { value: T } : never;
export type SymbolicExpected<T> = T extends string ? { value: T } : never;
export type ImportedActual = import('./dependency.js').Value;
export type ImportedExpected = { readonly value: string };
export type SelfActual = import('./relations.js').ImportedActual;
export type SelfExpected = ImportedActual;
function identity<T>(value: T): T { return value; }
const inferred = identity('hello' as const);
export type InferenceActual = typeof inferred;
export type InferenceExpected = 'hello';
`;
