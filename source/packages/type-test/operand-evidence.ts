import type { Signature, Type } from 'typescript-beta/async';
import { sourceDeclarations } from './source-analysis.ts';
import type { TypeAnalysis } from './source-analysis-port.ts';

const maximumOperandTypes = 2048;
export const recoveryTypeReason = 'Recovery types cannot establish a type relation.';

async function signatureTypes(checker: TypeAnalysis['checker'], signature: Signature): Promise<readonly Type[]> {
    const [ parameters, bindings, receiver, returns, predicate ] = await Promise.all([
        signature.getParameters(),
        signature.getTypeParameters(),
        signature.getThisParameter(),
        checker.getReturnTypeOfSignature(signature),
        checker.getTypePredicateOfSignature(signature)
    ]);
    const types = await Promise.all(parameters.map(async function parameterType(_parameter, index) {
        return await checker.getParameterType(signature, index);
    }));
    return [
        ...types,
        ...bindings,
        ...receiver === undefined ? [] : [ await checker.getTypeOfSymbol(receiver) ],
        returns,
        ...predicate?.type === undefined ? [] : [ predicate.type ]
    ];
}

async function memberTypes(checker: TypeAnalysis['checker'], type: Type): Promise<readonly Type[]> {
    const [ properties, indexes, calls, constructors ] = await Promise.all([
        type.getProperties(),
        type.getIndexInfos(),
        type.getCallSignatures(),
        type.getConstructSignatures()
    ]);
    const propertyTypes = properties.length === 0 ? [] : await checker.getTypeOfSymbol(properties);
    const signatures = await Promise.all([ ...calls, ...constructors ].map(async function types(signature) {
        return await signatureTypes(checker, signature);
    }));
    return [
        ...propertyTypes,
        ...indexes.flatMap(function indexTypes(index) {
            return [ index.keyType, index.valueType ];
        }),
        ...signatures.flat()
    ];
}

async function defaultLibraryType(analysis: TypeAnalysis, type: Type): Promise<boolean> {
    const symbol = type.isClassOrInterface() ? await type.getSymbol() : undefined;
    if (symbol === undefined || symbol.declarations.length === 0) {
        return false;
    }
    const declarations = await sourceDeclarations(symbol);
    const defaultLibrary = await Promise.all(declarations.map(async function library(declaration) {
        return await analysis.program.isSourceFileDefaultLibrary(declaration.getSourceFile());
    }));
    return declarations.length === symbol.declarations.length && defaultLibrary.every(Boolean);
}

async function declaredMemberTypes(analysis: TypeAnalysis, type: Type): Promise<readonly Type[]> {
    return await defaultLibraryType(analysis, type) ? [] : await memberTypes(analysis.checker, type);
}

async function objectTypes(analysis: TypeAnalysis, type: Type): Promise<readonly Type[]> {
    const aliases = await type.getAliasTypeArguments();
    if (!type.isTypeReference()) {
        return [ ...aliases, ...await declaredMemberTypes(analysis, type) ];
    }
    const argumentsOfType = await analysis.checker.getTypeArguments(type);
    const argumentsAndAliases = [ ...aliases, ...argumentsOfType ];
    if (type.isTupleType()) {
        return argumentsAndAliases;
    }
    const target = await type.getTarget();
    return target.id === type.id
        ? [ ...argumentsAndAliases, ...await declaredMemberTypes(analysis, type) ]
        : [ ...argumentsAndAliases, target ];
}

async function indexedTypes(type: Type): Promise<readonly Type[]> {
    if (type.isIndexType() || type.isStringMappingType()) {
        return [ await type.getTarget() ];
    }
    if (type.isIndexedAccessType()) {
        return await Promise.all([ type.getObjectType(), type.getIndexType() ]);
    }
    if (type.isSubstitutionType()) {
        return await Promise.all([ type.getBaseType(), type.getConstraint() ]);
    }
    return [];
}

async function relatedTypes(analysis: TypeAnalysis, type: Type): Promise<readonly (Type | undefined)[]> {
    if (type.isObjectType()) {
        return await objectTypes(analysis, type);
    }
    if (type.isTypeParameter()) {
        return await Promise.all([ type.getConstraint(), type.getDefault() ]);
    }
    if (type.isConditionalType()) {
        return await Promise.all([
            type.getCheckType(),
            type.getExtendsType(),
            type.getTrueType(),
            type.getFalseType()
        ]);
    }
    return await indexedTypes(type);
}

async function nestedTypes(analysis: TypeAnalysis, type: Type): Promise<readonly Type[]> {
    if (type.isUnionType() || type.isIntersectionType() || type.isTemplateLiteralType()) {
        return await type.getTypes();
    }
    const types = await relatedTypes(analysis, type);
    return types.filter(function available(child) {
        return child !== undefined;
    });
}

function operandProblem(type: Type, inspected: number): string | null {
    if (type.isErrorType()) {
        return recoveryTypeReason;
    }
    return inspected >= maximumOperandTypes
        ? `Type relation operands exceed the supported inspection limit of ${maximumOperandTypes} types.`
        : null;
}

export async function invalidOperand(analysis: TypeAnalysis, operands: readonly Type[]): Promise<string | null> {
    const pending = Array.from(operands);
    const seen = new Set<number>();
    async function inspectOperand(type: Type): Promise<string | null> {
        if (seen.has(type.id)) {
            return null;
        }
        const problem = operandProblem(type, seen.size);
        if (problem === null) {
            seen.add(type.id);
            const children = await nestedTypes(analysis, type);
            for (const child of children) {
                pending.push(child);
            }
        }
        return problem;
    }
    let type = pending.pop();
    while (type !== undefined) {
        const problem = await inspectOperand(type);
        if (problem !== null) {
            return problem;
        }
        type = pending.pop();
    }
    return null;
}
