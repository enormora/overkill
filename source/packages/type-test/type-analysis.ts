import type { Checker } from 'typescript-beta/async';
import type { CompilerSyntax } from './installed-compiler.ts';

export type TypeAnalysis = {
    readonly compiler: CompilerSyntax;
    readonly checker: Pick<
        Checker,
        | 'getParameterType'
        | 'getReturnTypeOfSignature'
        | 'getTypeAtLocation'
        | 'getTypeFromTypeNode'
        | 'getTypeOfSymbol'
        | 'getTypePredicateOfSignature'
        | 'isReadonlySymbol'
        | 'isTypeAssignableTo'
        | 'typeToString'
    >;
};
