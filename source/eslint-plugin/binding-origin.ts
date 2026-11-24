import { match } from 'ts-pattern';
import { AST_NODE_TYPES as NodeType, type TSESTree as Tree } from '@typescript-eslint/utils';

type FunctionExpression = Readonly<Tree.ArrowFunctionExpression | Tree.FunctionExpression>;
export type FunctionNode = FunctionExpression | Readonly<Tree.FunctionDeclaration>;

type LocalFunction = { readonly kind: 'function'; readonly node: FunctionNode; };
type CallResult = { readonly kind: 'call'; readonly node: Readonly<Tree.CallExpression>; };
type ModuleImport = { readonly kind: 'import'; readonly source: string; };
type CallbackParameter = { readonly kind: 'parameter'; readonly owner: FunctionNode; readonly index: number; };

export type BindingOrigin = {
    readonly root: CallbackParameter | LocalFunction | ModuleImport | CallResult;
    readonly path: readonly string[];
};

export function sameOrigin(left: BindingOrigin, right: BindingOrigin): boolean {
    if (
        left.path.length !== right.path.length || left.path.some(function (key, index) {
            return key !== right.path[index];
        })
    ) {
        return false;
    }
    return match(left.root)
        .with({ kind: 'import' }, function (matched) {
            return right.root.kind === 'import' && matched.source === right.root.source;
        })
        .with({ kind: 'parameter' }, function (matched) {
            return right.root.kind === 'parameter' && matched.owner === right.root.owner &&
                matched.index === right.root.index;
        })
        .with({ kind: 'call' }, function (matched) {
            return right.root.kind === 'call' && matched.node === right.root.node;
        })
        .with({ kind: 'function' }, function (matched) {
            return right.root.kind === 'function' && matched.node === right.root.node;
        })
        .exhaustive();
}

const functionTypes: ReadonlySet<NodeType> = new Set([
    NodeType.ArrowFunctionExpression,
    NodeType.FunctionExpression,
    NodeType.FunctionDeclaration
]);

export function isFunction(node: Readonly<Tree.Node>): node is FunctionNode {
    return functionTypes.has(node.type);
}
