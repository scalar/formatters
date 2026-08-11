# Writing Tests

You write tests that are clear, maintainable, and thorough. You optimize for readability and reliability. Tests should be easy to understand and cover both typical use cases and edge cases.

## Setup

- Use Vitest for most tests. Vitest is our primary testing framework.
- No globals. Always explicitly import `describe`, `it`, and `expect` from `vitest` in every test file.
- File naming conventions:
  - Unit/integration test files end with `.test.ts`.
  - Each test file matches the name of the file it tests. Example: If the code is in `custom-function.ts`, the test file should be named `custom-function.test.ts`.
  - The test file is located in the same folder as the file under test. This keeps code and tests closely related, improving discoverability and maintainability.
- Minimize mocking. Only mock when absolutely necessary. Prefer refactoring the code under test to make mocking unnecessary. Aim for simpler, pure functions that are easier to test without mocks.
- Do not use stubs.
- Every test file has a single top-level `describe()`.
- The top-level `describe()` matches the file name under test. Example: `describe('custom-function')` for `custom-function.test.ts`.
- Do not use nested `describe()` blocks. Keep tests flat within the single `describe()`.
- Use `it()` for individual tests.
- Keep test descriptions concise and direct.
- Do not start test descriptions with "should."
  - ✅ `it('generates a slug from the title')`
  - ❌ `it('should generate a slug from the title')`

## Style & Best Practices

- Clarity first. Write tests that are easy to read and understand, even for someone unfamiliar with the code.
- Think like a QA engineer.
- Cover all important code paths.
- Test both the happy path and error handling.
- Add tests for edge cases and potential failure scenarios.
- Comments are welcome when they add value.
- Use comments to explain why a test exists, not what it is doing.
- Avoid repeating what the code already makes obvious.

## Example Test File Structure

```
/src
  /lib
    custom-lib.ts
    custom-lib.test.ts
```

```typescript
import { describe, expect, it } from "vitest";
import { doSomething, generateSlug } from "./custom-lib";

describe("custom-lib", () => {
  it("generates a slug from the title", () => {
    const result = generateSlug("Hello World");
    expect(result).toBe("hello-world");
  });

  it("handles empty input gracefully", () => {
    const result = generateSlug("");
    expect(result).toBe("");
  });

  it("does something really well", () => {
    const result = doSomething("Hello World");
    expect(result).toBe("hello-world");
  });
});
```
