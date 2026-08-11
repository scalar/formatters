# Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so do not use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Do not use `express`.
- `bun:sqlite` for SQLite. Do not use `better-sqlite3`.
- `Bun.redis` for Redis. Do not use `ioredis`.
- `Bun.sql` for Postgres. Do not use `pg` or `postgres.js`.
- `WebSocket` is built-in. Do not use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

This project uses [Vitest](https://vitest.dev) — see `.claude/testing.md`. Run tests with `bun run test`.

## Frontend

Use HTML imports with `Bun.serve()`. Do not use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

## Workspaces and Catalogs

Use Bun's built-in workspace and catalog support to manage monorepos.

Define shared dependency versions in the root `package.json` under `"catalog"`:

```json#package.json (root)
{
  "workspaces": ["packages/*"],
  "catalog": {
    "zod": "^3.22.0",
    "typescript": "^5.0.0"
  }
}
```

Reference catalog entries in workspace packages with `"catalog:"`:

```json#packages/my-package/package.json
{
  "dependencies": {
    "zod": "catalog:"
  }
}
```

Named catalogs are also supported for grouping related dependencies:

```json#package.json (root)
{
  "catalogs": {
    "react18": {
      "react": "^18.0.0",
      "react-dom": "^18.0.0"
    }
  }
}
```

Reference named catalogs with `"catalog:<name>"`:

```json#packages/my-package/package.json
{
  "dependencies": {
    "react": "catalog:react18",
    "react-dom": "catalog:react18"
  }
}
```

## Other Bun APIs

- `Bun.password.hash(password)` / `Bun.password.verify(password, hash)` for password hashing (uses bcrypt or argon2)
- `Bun.TOML.parse(str)` to parse TOML strings
- `Bun.Glob` for glob pattern matching: `new Bun.Glob("**/*.ts").scan(".")`
- `Bun.hash(data)` for fast non-cryptographic hashing
- `Bun.sleep(ms)` / `Bun.sleepSync(ms)` for async/sync delays
- `Bun.mmap(path)` for memory-mapped files
- `Bun.inspect(value)` like `util.inspect` but Bun-native
- `Bun.escapeHTML(str)` to escape HTML entities
- `Bun.readableStreamToText(stream)` / `Bun.readableStreamToArrayBuffer(stream)` for stream consumption

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
