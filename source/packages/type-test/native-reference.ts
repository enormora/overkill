import type * as TypeScript from 'typescript-beta/ast';
import { sourceSymbol, sourceDeclarations, type SourceAnalysis } from './source-analysis.ts';

type BindingKind = 'relation';
type Binding = { readonly matcher: string; readonly kind: BindingKind; };
const bindings: Readonly<Record<string, Binding>> = {
    sameType: { matcher: 'toBe', kind: 'relation' },
    assignableTo: { matcher: 'toBeAssignableTo', kind: 'relation' },
    assignableFrom: { matcher: 'toBeAssignableFrom', kind: 'relation' }
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

export async function nativeMatcherBinding(
    analysis: SourceAnalysis,
    expression: TypeScript.Expression
): Promise<Binding | null> {
    const location = analysis.compiler.isPropertyAccessExpression(expression) ? expression.name : expression;
    const symbol = await sourceSymbol(analysis, location);
    if (symbol === undefined) {
        return null;
    }
    const binding = bindings[symbol.name];
    const declarations = await sourceDeclarations(symbol);
    return binding !== undefined && declarations.some(adapterDeclaration) ? binding : null;
}

type ReferenceBinding = { readonly binding: Binding; readonly members: readonly string[]; };
async function referenceBinding(analysis: SourceAnalysis, original: TypeScript.Expression): Promise<ReferenceBinding> {
    let expression = original;
    let members: readonly string[] = [];
    let binding = await nativeMatcherBinding(analysis, expression);
    while (binding === null && analysis.compiler.isPropertyAccessExpression(expression)) {
        members = [ expression.name.text, ...members ];
        expression = expression.expression;
        binding = await nativeMatcherBinding(analysis, expression);
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
function referenceForm(members: readonly string[]): ReferenceForm {
    const [ member ] = members;
    if (member === undefined) {
        return 'typed';
    }
    const form = referenceForms.get(member);
    if (members.length !== 1 || form === undefined) {
        throw new Error('Unsupported native assertion reference form.');
    }
    return form;
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

function validateReferenceSyntax(form: ReferenceForm, syntax: ReferenceSyntax): void {
    const count = { typed: 2, withActual: 1, withExpected: 1, expressions: 0 }[form];
    if (syntax.called !== count > 0 || syntax.types.length !== count || syntax.operands.length > 0) {
        throw new Error('Invalid native reference factory arguments.');
    }
}

export async function nativeReference(analysis: SourceAnalysis, node: TypeScript.Expression): Promise<NativeReference> {
    const syntax = referenceSyntax(analysis, node);
    const { binding, members } = await referenceBinding(analysis, syntax.expression);
    const negated = members[0] === 'not';
    const form = referenceForm(negated ? members.slice(1) : members);
    validateReferenceSyntax(form, syntax);
    return { ...binding, negated, form, types: syntax.types };
}
