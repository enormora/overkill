import {
    runIfMain as runPackagedIfMain,
    type Metadata,
    type OutputRenderer,
    type Reporter,
    type TestNode
} from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';

type TestSupportRunIfMainRootOptions = {
    readonly metadata: Metadata;
    readonly name: string;
};

export type TestSupportRunIfMainOptions = {
    readonly outputRenderer?: OutputRenderer;
    readonly reporters?: readonly Reporter[];
    readonly root?: TestSupportRunIfMainRootOptions;
};

function runOptions(options: TestSupportRunIfMainOptions | undefined): TestSupportRunIfMainOptions {
    return options ?? { reporters: [ createLineReporter() ] };
}

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: TestSupportRunIfMainOptions
): Promise<void> {
    await runPackagedIfMain(
        meta,
        testNode,
        runOptions(options)
    );
}
