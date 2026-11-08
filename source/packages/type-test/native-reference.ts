import type TypeScript from 'typescript';
import { sourceSymbol, type SourceAnalysis } from './source-analysis.ts';

type BindingKind = 'ability' | 'decorator' | 'instantiation' | 'relation';
type Binding = { readonly matcher: string; readonly kind: BindingKind; };
const bindings: Readonly<Record<string, Binding>> = {
    sameType: { matcher: 'toBe', kind: 'relation' },
    assignableTo: { matcher: 'toBeAssignableTo', kind: 'relation' },
    assignableFrom: { matcher: 'toBeAssignableFrom', kind: 'relation' },
    acceptsProps: { matcher: 'toAcceptProps', kind: 'ability' },
    applicableTo: { matcher: 'toBeApplicable', kind: 'decorator' },
    callableWith: { matcher: 'toBeCallableWith', kind: 'ability' },
    constructableWith: { matcher: 'toBeConstructableWith', kind: 'ability' },
    instantiableWith: { matcher: 'toBeInstantiableWith', kind: 'instantiation' },
    hasProperty: { matcher: 'toHaveProperty', kind: 'ability' },
    raisesTypeError: { matcher: 'toRaiseError', kind: 'ability' }
};
type ReferenceForm = 'expressions' | 'typed' | 'withActual' | 'withExpected';
export type NativeReference = Binding & {
    readonly negated: boolean;
    readonly form: ReferenceForm;
    readonly types: readonly TypeScript.TypeNode[];
};

function adapterDeclaration(declaration: TypeScript.Declaration): boolean {
    const path = declaration.getSourceFile().fileName.replaceAll('\\', '/');
    return path.endsWith('/packages/type-test/type-test.entry-point.ts') ||
        path.includes('/node_modules/@overkill-dev/type-test/');
}

export function nativeMatcherBinding(analysis: SourceAnalysis, expression: TypeScript.Expression): Binding | null {
    const location = analysis.compiler.isPropertyAccessExpression(expression) ? expression.name : expression;
    const symbol = sourceSymbol(analysis, location);
    if (symbol === undefined) {
        return null;
    }
    const binding = bindings[symbol.name];
    return binding !== undefined && symbol.declarations?.some(adapterDeclaration) === true ? binding : null;
}

type ReferenceBinding = { readonly binding: Binding; readonly members: readonly string[]; };
function referenceBinding(analysis: SourceAnalysis, original: TypeScript.Expression): ReferenceBinding {
    let expression = original;
    let members: readonly string[] = [];
    let binding = nativeMatcherBinding(analysis, expression);
    while (binding === null && analysis.compiler.isPropertyAccessExpression(expression)) {
        members = [ expression.name.text, ...members ];
        expression = expression.expression;
        binding = nativeMatcherBinding(analysis, expression);
    }
    if (binding === null) {
        throw new Error('Assertion reference is not an adapter-owned export.');
    }
    return { binding, members };
}

const referenceForms: ReadonlyMap<string, ReferenceForm> = new Map([
    [ 'withActual', 'withActual' ],
    [ 'withExpected', 'withExpected' ],
    [ 'expressions', 'expressions' ]
]);
function referenceForm(members: readonly string[], kind: BindingKind): ReferenceForm {
    const [ member ] = members;
    if (member === undefined) {
        return 'typed';
    }
    const form = referenceForms.get(member);
    if (members.length !== 1 || form === undefined) {
        throw new Error('Unsupported native assertion reference form.');
    }
    if (kind !== 'relation' && form !== 'withActual') {
        throw new Error('Unsupported native assertion reference form.');
    }
    return form;
}

function expectedTypeCount(kind: BindingKind, form: ReferenceForm): number {
    const counts: Readonly<Record<BindingKind, Readonly<Record<ReferenceForm, number>>>> = {
        relation: { typed: 2, withActual: 1, withExpected: 1, expressions: 0 },
        ability: { typed: 1, withActual: 0, withExpected: 0, expressions: 0 },
        decorator: { typed: 1, withActual: 0, withExpected: 0, expressions: 0 },
        instantiation: { typed: 2, withActual: 1, withExpected: 0, expressions: 0 }
    };
    return counts[kind][form];
}

type ReferenceSyntax = {
    readonly expression: TypeScript.Expression;
    readonly types: readonly TypeScript.TypeNode[];
    readonly operands: readonly TypeScript.Expression[];
    readonly called: boolean;
};
function referenceSyntax(analysis: SourceAnalysis, node: TypeScript.Expression): ReferenceSyntax {
    return analysis.compiler.isCallExpression(node)
        ? {
            expression: node.expression,
            types: Array.from(node.typeArguments ?? []),
            operands: node.arguments,
            called: true
        }
        : { expression: node, types: [], operands: [], called: false };
}

function validateDecoratorSyntax(syntax: ReferenceSyntax): void {
    if (!syntax.called || syntax.operands.length !== 1 || syntax.types.length > 1) {
        throw new Error('Decorator expression references require one actual operand.');
    }
}

function validateReferenceSyntax(binding: Binding, form: ReferenceForm, syntax: ReferenceSyntax): void {
    if (binding.kind === 'decorator' && form === 'withActual') {
        validateDecoratorSyntax(syntax);
        return;
    }
    const count = expectedTypeCount(binding.kind, form);
    if (syntax.called !== count > 0 || syntax.types.length !== count || syntax.operands.length > 0) {
        throw new Error('Invalid native reference factory arguments.');
    }
}

export function nativeReference(analysis: SourceAnalysis, node: TypeScript.Expression): NativeReference {
    const syntax = referenceSyntax(analysis, node);
    const { binding, members } = referenceBinding(analysis, syntax.expression);
    const negated = members[0] === 'not';
    const form = referenceForm(negated ? members.slice(1) : members, binding.kind);
    validateReferenceSyntax(binding, form, syntax);
    return { ...binding, negated, form, types: syntax.types };
}
