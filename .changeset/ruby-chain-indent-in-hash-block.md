---
"@scalar/ruby-fmt": patch
---

A wrapped method chain inside a block that is a hash value keeps its indentation again. RuboCop 1.84.1 through 1.91 mistake such a chain for the hash value itself and align every continuation line with the receiver, so this, from a lambda per test case:

```ruby
run: -> do
  client
    .beta
    .messages
end
```

came back with `.beta` and `.messages` flush under `client`. A boot-time patch to `Layout/MultilineMethodCallIndentation`, in `src/rubocop-patch.ts`, stops the cop's search for the enclosing hash pair where a block, `begin`, `if` or loop body starts, which restores the indentation RuboCop 1.82 gave these chains. A chain that is itself the hash value is still aligned the way stock RuboCop 1.91 aligns it, and over 1,238 files of real Ruby the patch changes none of them. The status in the README moves from `exact +3 fixes` to `exact +4 fixes`.
