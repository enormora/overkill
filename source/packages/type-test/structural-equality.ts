import type { Type, TypeParameter, Signature, Symbol as CompilerSymbol, IndexInfo } from 'typescript-beta/async';

import { sameNominalMember, sameNominalSymbols } from './nominal-evidence.ts';
import { sourceDeclarations } from './source-analysis.ts';
import type { TypeAnalysis } from './source-analysis-port.ts';

import { established, type RelationEvidence } from './relation-evidence.ts';

const maximumComparisonDepth = 256;

const unsupported: RelationEvidence = {
    kind: 'inconclusive',
    reason: 'Public compiler evidence does not establish structural equivalence for this type.'
};

type Comparison = {
    readonly analysis: TypeAnalysis;
    readonly compare: (context: Comparison, actual: Type, expected: Type) => Promise<RelationEvidence>;
    readonly binders: ReadonlyMap<number, number>;
    readonly active: ReadonlySet<string>;
};

type ComparisonResult = RelationEvidence | null;

type ComparisonRule = (
    context: Comparison,
    actual: Type,
    expected: Type
) => ComparisonResult | Promise<ComparisonResult>;

type ComparisonMatrix = readonly (readonly RelationEvidence[])[];

function hasCompilerFlag(value: number, flag: number): boolean {
    // eslint-disable-next-line no-bitwise -- Compiler APIs encode public type and symbol metadata as bit flags.
    return (value & flag) !== 0;
}

async function all(comparisons: readonly Promise<RelationEvidence>[]): Promise<RelationEvidence> {
    const results = await Promise.all(comparisons);
    return results.find(function unequal(result) {
        return result.kind === 'established' && !result.holds;
    }) ?? results.find(function uncertain(result) {
        return result.kind === 'inconclusive';
    }) ?? established(true);
}

function binders(
    context: Comparison,
    actual: readonly TypeParameter[],
    expected: readonly TypeParameter[]
): Comparison | null {
    if (actual.length !== expected.length) {
        return null;
    }
    const correspondence = new Map(context.binders);
    for (const [ index, binding ] of actual.entries()) {
        const target = expected[index];
        if (target === undefined) {
            return null;
        }
        correspondence.set(binding.id, target.id);
    }
    return { ...context, binders: correspondence };
}

function availableColumn(
    result: RelationEvidence | undefined,
    possible: boolean,
    seen: ReadonlySet<number>,
    column: number
): boolean {
    if (result === undefined || seen.has(column)) {
        return false;
    }
    return result.kind === 'inconclusive' ? possible : result.holds;
}

function completeMatching(matrix: ComparisonMatrix, possible: boolean): boolean {
    const assignments = new Map<number, number>();
    function augment(row: number): boolean {
        const seen = new Set<number>();
        const search = {
            visit(candidateRow: number): boolean {
                return matrix.some(function (_entry, index) {
                    return search.assign(candidateRow, index);
                });
            },
            assign(candidateRow: number, column: number): boolean {
                if (!availableColumn(matrix[candidateRow]?.[column], possible, seen, column)) {
                    return false;
                }
                seen.add(column);
                const previous = assignments.get(column);
                if (previous !== undefined && !search.visit(previous)) {
                    return false;
                }
                assignments.set(column, candidateRow);
                return true;
            }
        };
        return search.visit(row);
    }
    return matrix.every(function row(_entry, index) {
        return augment(index);
    });
}

function matchingEvidence(matrix: ComparisonMatrix): RelationEvidence {
    if (completeMatching(matrix, false)) {
        return established(true);
    }
    return completeMatching(matrix, true) ? unsupported : established(false);
}

function structured(type: Type): boolean {
    return type.isObjectType() || type.isIntersectionType();
}

function opaque(type: Type): boolean {
    return type.isConditionalType() || type.isIndexedAccessType() || type.isIndexType() ||
        type.isTemplateLiteralType() || type.isStringMappingType();
}

async function symbolicMapped(type: Type): Promise<boolean> {
    if (!type.isMappedType()) {
        return false;
    }
    const properties = await type.getProperties();
    return properties.length === 0;
}

function binderIdentity(context: Comparison, actual: TypeParameter, expected: TypeParameter): RelationEvidence {
    const target = context.binders.get(actual.id);
    if (target !== undefined) {
        return established(target === expected.id);
    }
    return actual.id === expected.id ? established(true) : unsupported;
}

async function signatureParameter(callSignature: Signature, index: number): Promise<CompilerSymbol | undefined> {
    const declaredParameters = await callSignature.getParameters();
    return declaredParameters[index];
}

async function constParameter(context: Comparison, binding: TypeParameter): Promise<boolean | null> {
    const symbol = await binding.getSymbol();
    if (symbol === undefined) {
        return null;
    }
    const declarations = await sourceDeclarations(symbol);
    const declaration = declarations.find(context.analysis.compiler.isTypeParameterDeclaration);
    if (declaration === undefined) {
        return null;
    }
    return declaration.modifiers?.some(function constModifier(modifier) {
        return modifier.kind === context.analysis.compiler.SyntaxKind.ConstKeyword;
    }) ?? false;
}

async function parameterShape(context: Comparison, symbol: CompilerSymbol): Promise<string | null> {
    const declarations = await sourceDeclarations(symbol);
    const declaration = declarations.find(context.analysis.compiler.isParameterDeclaration);
    return declaration === undefined ? null : JSON.stringify([
        declaration.questionToken !== undefined || declaration.initializer !== undefined,
        declaration.dotDotDotToken !== undefined
    ]);
}

function intrinsic(_context: Comparison, actual: Type, expected: Type): RelationEvidence | null {
    if (!actual.isIntrinsicType() && !expected.isIntrinsicType()) {
        return null;
    }
    if (!actual.isIntrinsicType() || !expected.isIntrinsicType()) {
        return established(false);
    }
    return established(actual.intrinsicName === expected.intrinsicName);
}

function literal(_context: Comparison, actual: Type, expected: Type): RelationEvidence | null {
    if (!actual.isLiteralType() && !expected.isLiteralType()) {
        return null;
    }
    if (!actual.isLiteralType() || !expected.isLiteralType()) {
        return established(false);
    }
    return established(actual.flags === expected.flags && actual.value === expected.value);
}

function typeParameter(context: Comparison, actual: Type, expected: Type): RelationEvidence | null {
    if (!actual.isTypeParameter() && !expected.isTypeParameter()) {
        return null;
    }
    if (!actual.isTypeParameter() || !expected.isTypeParameter()) {
        return unsupported;
    }
    return binderIdentity(context, actual, expected);
}

async function uniqueSymbol(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence | null> {
    const flag = context.analysis.compiler.TypeFlags.UniqueESSymbol;
    if (!hasCompilerFlag(actual.flags, flag) && !hasCompilerFlag(expected.flags, flag)) {
        return null;
    }
    if (!hasCompilerFlag(actual.flags, flag) || !hasCompilerFlag(expected.flags, flag)) {
        return established(false);
    }
    return await sameNominalSymbols(actual, expected, unsupported);
}

function symbolic(_context: Comparison, actual: Type, expected: Type): RelationEvidence | null {
    return opaque(actual) || opaque(expected) ? unsupported : null;
}

async function enumLiteral(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence | null> {
    const flag = context.analysis.compiler.TypeFlags.EnumLiteral;
    if (!hasCompilerFlag(actual.flags, flag) && !hasCompilerFlag(expected.flags, flag)) {
        return null;
    }
    if (!hasCompilerFlag(actual.flags, flag) || !hasCompilerFlag(expected.flags, flag)) {
        return established(false);
    }
    return await sameNominalSymbols(actual, expected, unsupported);
}

function comparisonBoundary(context: Comparison, key: string): RelationEvidence | null {
    if (context.active.has(key)) {
        return established(true);
    }
    if (context.active.size >= maximumComparisonDepth) {
        return {
            kind: 'inconclusive',
            reason: 'Equality evidence exceeds the supported recursive expansion depth of 256.'
        };
    }
    return null;
}

async function optionalType(
    context: Comparison,
    actual: Type | undefined,
    expected: Type | undefined
): Promise<RelationEvidence> {
    return actual === undefined || expected === undefined
        ? established(actual === expected)
        : await context.compare(context, actual, expected);
}

async function union(
    context: Comparison,
    actual: readonly Type[],
    expected: readonly Type[]
): Promise<RelationEvidence> {
    if (actual.length !== expected.length) {
        return established(false);
    }
    const matrix = await Promise.all(actual.map(async function (type) {
        return await Promise.all(expected.map(async function (target) {
            return await context.compare(context, type, target);
        }));
    }));
    return matchingEvidence(matrix);
}

async function member(
    context: Comparison,
    actual: CompilerSymbol,
    expected: CompilerSymbol
): Promise<RelationEvidence> {
    const { checker, compiler } = context.analysis;
    const optional = hasCompilerFlag(actual.flags, compiler.SymbolFlags.Optional);
    const expectedOptional = hasCompilerFlag(expected.flags, compiler.SymbolFlags.Optional);
    if (optional !== expectedOptional) {
        return established(false);
    }
    if (await checker.isReadonlySymbol(actual) !== await checker.isReadonlySymbol(expected)) {
        return established(false);
    }
    if (context.binders.size > 0 && !await sameNominalMember(compiler, actual, expected)) {
        return established(false);
    }
    return await context.compare(
        context,
        await checker.getTypeOfSymbol(actual),
        await checker.getTypeOfSymbol(expected)
    );
}

async function members(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence> {
    const left = await actual.getProperties();
    const right = await expected.getProperties();
    if (left.length !== right.length) {
        return established(false);
    }
    return await all(left.map(async function (symbol) {
        const target = right.find(function named(entry) {
            return entry.escapedName === symbol.escapedName;
        });
        return target === undefined ? established(false) : await member(context, symbol, target);
    }));
}

async function indexSignature(context: Comparison, actual: IndexInfo, expected: IndexInfo): Promise<RelationEvidence> {
    if (actual.isReadonly !== expected.isReadonly) {
        return established(false);
    }
    return await all([
        context.compare(context, actual.keyType, expected.keyType),
        context.compare(context, actual.valueType, expected.valueType)
    ]);
}

async function indexes(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence> {
    const left = await actual.getIndexInfos();
    const right = await expected.getIndexInfos();
    if (left.length !== right.length) {
        return established(false);
    }
    const matrix = await Promise.all(left.map(async function actualIndex(info) {
        return await Promise.all(right.map(async function expectedIndex(target) {
            return await indexSignature(context, info, target);
        }));
    }));
    return matchingEvidence(matrix);
}

async function binder(context: Comparison, actual: TypeParameter, expected: TypeParameter): Promise<RelationEvidence> {
    const leftConst = await constParameter(context, actual);
    const rightConst = await constParameter(context, expected);
    if (leftConst === null || rightConst === null) {
        return unsupported;
    }
    return await all([
        Promise.resolve(established(leftConst === rightConst)),
        optionalType(context, await actual.getConstraint(), await expected.getConstraint()),
        optionalType(context, await actual.getDefault(), await expected.getDefault())
    ]);
}

async function genericParameters(
    context: Comparison,
    actual: Signature,
    expected: Signature
): Promise<RelationEvidence> {
    const left = await actual.getTypeParameters();
    const right = await expected.getTypeParameters();
    return await all(left.map(async function (type, position) {
        const target = right[position];
        return target === undefined ? established(false) : await binder(context, type, target);
    }));
}

async function parameter(
    context: Comparison,
    actual: Signature,
    expected: Signature,
    index: number
): Promise<RelationEvidence> {
    const left = await signatureParameter(actual, index);
    const right = await signatureParameter(expected, index);
    if (left === undefined || right === undefined) {
        return established(false);
    }
    const shape = await parameterShape(context, left);
    const targetShape = await parameterShape(context, right);
    if (shape === null || targetShape === null) {
        return unsupported;
    }
    return await all([
        Promise.resolve(established(shape === targetShape)),
        context.compare(
            context,
            await context.analysis.checker.getParameterType(actual, index),
            await context.analysis.checker.getParameterType(expected, index)
        )
    ]);
}

async function parameters(context: Comparison, actual: Signature, expected: Signature): Promise<RelationEvidence> {
    const left = await actual.getParameters();
    const right = await expected.getParameters();
    if (left.length !== right.length) {
        return established(false);
    }
    return await all(left.map(async function (_symbol, index) {
        return await parameter(context, actual, expected, index);
    }));
}

async function thisParameter(context: Comparison, actual: Signature, expected: Signature): Promise<RelationEvidence> {
    const left = await actual.getThisParameter();
    const right = await expected.getThisParameter();
    return await optionalType(
        context,
        left === undefined ? undefined : await context.analysis.checker.getTypeOfSymbol(left),
        right === undefined ? undefined : await context.analysis.checker.getTypeOfSymbol(right)
    );
}

async function predicates(context: Comparison, actual: Signature, expected: Signature): Promise<RelationEvidence> {
    const left = await context.analysis.checker.getTypePredicateOfSignature(actual);
    const right = await context.analysis.checker.getTypePredicateOfSignature(expected);
    if (left === undefined || right === undefined) {
        return established(left === right);
    }
    return await all([
        Promise.resolve(established(left.kind === right.kind && left.parameterIndex === right.parameterIndex)),
        optionalType(context, left.type, right.type)
    ]);
}

async function signature(context: Comparison, actual: Signature, expected: Signature): Promise<RelationEvidence> {
    const paired = binders(context, await actual.getTypeParameters(), await expected.getTypeParameters());
    if (paired === null) {
        return established(false);
    }
    return await all([
        genericParameters(paired, actual, expected),
        parameters(paired, actual, expected),
        thisParameter(paired, actual, expected),
        predicates(paired, actual, expected),
        context.compare(
            paired,
            await context.analysis.checker.getReturnTypeOfSignature(actual),
            await context.analysis.checker.getReturnTypeOfSignature(expected)
        )
    ]);
}

async function orderedEvidence<Entry>(
    actual: readonly Entry[],
    expected: readonly Entry[],
    compareEntries: (actual: Entry, expected: Entry) => Promise<RelationEvidence>
): Promise<RelationEvidence> {
    if (actual.length !== expected.length) {
        return established(false);
    }
    return await all(actual.map(async function (value, index) {
        const target = expected[index];
        return target === undefined ? established(false) : await compareEntries(value, target);
    }));
}

async function substitution(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence | null> {
    if (!actual.isSubstitutionType() && !expected.isSubstitutionType()) {
        return null;
    }
    return actual.isSubstitutionType() && expected.isSubstitutionType()
        ? await all([
            context.compare(context, await actual.getBaseType(), await expected.getBaseType()),
            context.compare(context, await actual.getConstraint(), await expected.getConstraint())
        ])
        : established(false);
}

async function unions(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence | null> {
    if (!actual.isUnionType() && !expected.isUnionType()) {
        return null;
    }
    return actual.isUnionType() && expected.isUnionType()
        ? await union(context, await actual.getTypes(), await expected.getTypes())
        : established(false);
}

async function mutuallyAssignable(context: Comparison, actual: Type, expected: Type): Promise<boolean> {
    return await context.analysis.checker.isTypeAssignableTo(actual, expected) &&
        await context.analysis.checker.isTypeAssignableTo(expected, actual);
}

async function sameReferenceArguments(context: Comparison, actual: Type, expected: Type): Promise<boolean> {
    if (!actual.isTypeReference() || !expected.isTypeReference()) {
        return false;
    }
    const [ leftTarget, rightTarget ] = await Promise.all([ actual.getTarget(), expected.getTarget() ]);
    if (leftTarget.id !== rightTarget.id) {
        return false;
    }
    const { checker } = context.analysis;
    const [ left, right ] = await Promise.all([ checker.getTypeArguments(actual), checker.getTypeArguments(expected) ]);
    const argumentsEvidence = await orderedEvidence(left, right, async function compareArgument(value, target) {
        return await context.compare(context, value, target);
    });
    return argumentsEvidence.kind === 'established' && argumentsEvidence.holds;
}

async function objectStructure(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence> {
    async function compareSignature(left: Signature, right: Signature): Promise<RelationEvidence> {
        return await signature(context, left, right);
    }
    return await all([
        members(context, actual, expected),
        indexes(context, actual, expected),
        orderedEvidence(await actual.getCallSignatures(), await expected.getCallSignatures(), compareSignature),
        orderedEvidence(
            await actual.getConstructSignatures(),
            await expected.getConstructSignatures(),
            compareSignature
        )
    ]);
}

async function structuredEvidence(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence> {
    if (await symbolicMapped(actual) || await symbolicMapped(expected)) {
        return unsupported;
    }
    if (context.binders.size === 0) {
        return await mutuallyAssignable(context, actual, expected)
            ? await objectStructure(context, actual, expected)
            : established(false);
    }
    return await sameReferenceArguments(context, actual, expected)
        ? established(true)
        : await objectStructure(context, actual, expected);
}

async function structure(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence | null> {
    return structured(actual) && structured(expected) ? await structuredEvidence(context, actual, expected) : null;
}

const rules: readonly ComparisonRule[] = [
    substitution,
    typeParameter,
    symbolic,
    intrinsic,
    enumLiteral,
    literal,
    uniqueSymbol,
    unions,
    structure
];

async function compare(context: Comparison, actual: Type, expected: Type): Promise<RelationEvidence> {
    const key = JSON.stringify([ actual.id, expected.id, Array.from(context.binders) ]);
    const boundary = comparisonBoundary(context, key);
    if (boundary !== null) {
        return boundary;
    }
    const nested = { ...context, active: new Set([ ...context.active, key ]) };
    for (const rule of rules) {
        const result = await rule(nested, actual, expected);
        if (result !== null) {
            return result;
        }
    }
    return unsupported;
}

export async function compareEquality(
    analysis: TypeAnalysis,
    actual: Type,
    expected: Type
): Promise<RelationEvidence> {
    return await compare({ analysis, compare, binders: new Map(), active: new Set() }, actual, expected);
}
