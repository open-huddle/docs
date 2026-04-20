# Open Huddle documentation

[![Deploy](https://github.com/open-huddle/docs/actions/workflows/deploy.yml/badge.svg)](https://github.com/open-huddle/docs/actions/workflows/deploy.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/open-huddle/huddle/blob/main/LICENSE)

Source for the Open Huddle documentation site. Built with [Docusaurus 3](https://docusaurus.io/) and deployed to GitHub Pages.

## Local development

```bash
pnpm install
pnpm start
```

The dev server runs at `http://localhost:3000/docs/`.

## Production build

```bash
pnpm build
pnpm serve       # serves the build/ output locally
```

## Content layout

```text
docs/
├── intro.md
├── getting-started/
├── architecture/
├── operators/
├── contributors/
├── compliance/
└── adr/            # Architecture Decision Records
```

Pages are grouped via the sidebar in [`sidebars.ts`](./sidebars.ts). The sidebar is manual (not auto-generated) so category ordering is deterministic.

## Versioning

The live site serves one version at a time. Development happens on the **Next** version. When the code repo cuts a release tag, we freeze a matching documentation version:

```bash
pnpm docs:version 0.1.0
```

This copies the current `docs/` tree into `versioned_docs/version-0.1.0/` and adds an entry to `versions.json`. The dropdown in the navbar lets readers switch.

Versioned docs are committed — do not `.gitignore` `versioned_docs/` or `versioned_sidebars/`.

## Contributing

- Formatting: Prettier handles Markdown and TypeScript.
- Tone: concise, technical, second-person.
- Every page must answer three questions: *what is this, who is it for, what do I do next?*

PRs follow the same [DCO](https://developercertificate.org/) sign-off flow as the main repo: `git commit -s -m "docs: …"`.

## Deployment

GitHub Pages deployment is automated by [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). A push to `main` builds the site and publishes it.

The site is served at `https://open-huddle.github.io/docs/`. To move to a custom domain, add a `CNAME` file under `static/` and update `url` + `baseUrl` in `docusaurus.config.ts`.

## License

Documentation content is [Apache 2.0](https://github.com/open-huddle/huddle/blob/main/LICENSE), same as the codebase.
