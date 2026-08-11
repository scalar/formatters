# Great Comments for All Types

Use comments to explain **why**, not **what**. Most of the time, the code explains what is happening. Comments should clarify why a type or function exists, why you made specific decisions, or why a workaround is necessary.

Write friendly comments that sound human. Comments should be clear and helpful, not robotic or overly formal. Aim for a tone that is friendly and supportive, like you are helping a teammate understand the code later.

**Good:**

```typescript
/**
 * We load the user here to make sure we have fresh data when the component mounts.
 * Without this, the user info could be stale.
 */
```

**Bad:**

```typescript
/**
 * Load user.
 */
```

## Comment Guidelines

- Avoid contractions in comments. Use "do not" instead of "don't", "it is" instead of "it's", etc. This makes comments easier to read, especially for non-native speakers.
- If you use contractions, make sure they have proper apostrophes. Sometimes contractions can make a comment more approachable. If you choose to use them, use proper punctuation.
- Comment on types when their purpose is not obvious. If a type models an external API, or has a non-obvious constraint, explain it.
- Explain relationships between types when they are not clear.

**Example:**

```typescript
/**
 * Maps UserStatus to a badge color used in the UI.
 * Should stay in sync with the theme color palette.
 */
export type StatusColorMap = {
  active: "green";
  inactive: "gray";
};
```

- Document the intent of utility types or generic types.

**Example:**

```typescript
/**
 * Represents a partial object where at least one property is required.
 * Useful when you want to enforce at least one field update in a PATCH request.
 */
export type AtLeastOne<T> = {
  [K in keyof T]: Partial<T> & Pick<T, K>;
}[keyof T];
```

- For complex function signatures or composables, describe the behavior and usage.

**Example:**

```typescript
/**
 * useUser composable for loading and managing user data.
 * Fetches the user from the API and exposes reactive state.
 *
 * Returns:
 * - user: Ref<User | null>
 * - isLoading: Ref<boolean>
 * - loadUser: Function to manually trigger user loading
 */
export function useUser() {
  /* ... */
}
```

- If the type is temporary or will change later, leave a TODO comment.

**Example:**

```typescript
/**
 * TODO: Replace with dynamic permissions from backend when available.
 */
export type Permissions = "read" | "write" | "admin";
```

- Use JSDoc style consistently for types and functions that are exported or public. This improves editor support (tooltips, autocompletion) and helps other developers understand your code faster.

**Example:**

```typescript
/**
 * A user in the system.
 * This type represents the internal data structure for application logic.
 * If you need to expose user data publicly, use PublicUser.
 */
export type User = {
  /** Unique identifier for the user (UUID). */
  id: string;
  /** The user's full name. */
  name: string;
  /** Email address. Must be validated before saving. */
  email: string;
  /** ISO date string of when the user signed up. */
  createdAt: string;
  /** Whether the user has verified their email. */
  isVerified: boolean;
};
```
