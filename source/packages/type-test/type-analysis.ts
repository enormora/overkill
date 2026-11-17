import type { Checker } from 'typescript-beta/async';
import type { CompilerSyntax } from './installed-compiler.ts';

export type TypeAnalysis = {
    readonly compiler: CompilerSyntax;
    readonly checker: Pick<
        Checker,
        | 'getTypeAtLocation'
        | 'getTypeFromTypeNode'
        | 'typeToString'
        | 'isTypeAssignableTo'
        | 'isReadonlySymbol'
        | 'getTypeOfSymbol'
        | 'getParameterType'
        | 'getTypePredicateOfSignature'
        | 'getReturnTypeOfSignature'
    >;
};
