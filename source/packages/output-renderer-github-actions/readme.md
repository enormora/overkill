# `@overkill-dev/output-renderer-github-actions`

GitHub Actions renderer for Overkill managed output intents.

```ts
import { defineConfig } from '@overkill-dev/run/command-line';
import { createBriefReporter } from '@overkill-dev/reporter-brief';
import { createGithubActionsOutputRenderer } from '@overkill-dev/output-renderer-github-actions';

export const config = defineConfig({
    outputRenderer: createGithubActionsOutputRenderer(),
    reporters: [ createBriefReporter() ]
});
```

Located diagnostics render as GitHub workflow commands. Other managed output
renders as plain text. The renderer does not use the Checks API and is not
enabled automatically.
