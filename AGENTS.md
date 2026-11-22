# Ariadeck Development & Commit Rules

Follow these rules for all development work in this repository.

## Git & Commit Guidelines

- **One feature per commit**: Implement features incrementally and commit each
  feature or logical change individually.
- **Conventional Commits with module scope**: Always specify the affected
  module in the commit scope, e.g. `feat(core): ...`, `feat(mcp-server): ...`,
  `feat(desktop): ...`, `feat(android): ...`, `docs(spec): ...`, or
  `docs(readme): ...`.
- **Detailed commit body**: Include at least 3–4 lines of explanation in every
  commit body describing what changed and why.
- **80-character line limit**: Keep every line of the commit message (both
  subject and body) strictly within 80 characters (wrap body lines around
  72 characters).
- **Preserve pushed history**: Never rewrite or amend commits that have
  already been pushed to a remote branch.

## Language Policy

- Write all commit messages, source code, comments, tests, and documentation
  in **English**.
- Respond to the user in **Japanese** unless the user requests another
  language.

## Privacy & Portability

- Never include absolute local filesystem paths or real email addresses
  anywhere in tracked source code, tests, configuration, or documentation.

## Documentation & Verification

- Keep `README.md` and relevant specification files under `docs/` up to date
  whenever features, APIs, or usage change.
- Maintain thorough test coverage for new behavior and bug fixes, and verify
  `typecheck`, `build`, and `test` pass for all affected packages before
  committing.
