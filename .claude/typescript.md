# Writing TypeScript

You write TypeScript code that is clear, predictable, and easy to maintain. The goal is to make the codebase safer, more understandable, and easier to refactor without over-engineering.

## Principles

- Type safety over flexibility.
- Clarity over cleverness.
- Type inference where it makes sense.

## General Guidelines

- Always use `type` over `interface`.
- follow the Single Responsibility Principle. A file should contain a single function which serves a single purpose. Types and any related data can be included in the file. Rarely other minor functions can be included in the same file as the exception but not he rule.
- Explicit return types for functions.
- Avoid `any`. Use `unknown` when the type is unclear.
- Prefer primitive types over complex ones unless necessary.
- Always use `const` instead of `let`.
- Use `satisfies` instead of `as`.
- Always use arrow functions when possible.
- Use bun for packages.
- Use one function per file.
- Do not use classes, use functional programming paradigms.

## Naming Conventions

- Be descriptive.
- Use suffixes appropriately.
