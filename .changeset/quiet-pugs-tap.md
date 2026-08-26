---
'@scalar/csharp-fmt': patch
---

Cut about 95ms off the Node boot by handing the runtime's assets over directly instead of wrapping each one in a `Response`. Constructing the first `Response` in a Node process is what makes Node load its `fetch` implementation, and reading 21MB of assets back out of response bodies cost another stream copy on top - neither had anything to do with the bytes, which were already in hand. The archive is also expanded in one chunk rather than the 16KB default, which is another ~20ms. Output is unchanged: the whole 169-file benchmark corpus formats byte-for-byte identically, and identically to native CSharpier 1.3.0.
