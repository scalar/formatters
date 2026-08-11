# Third-party notices

`csharp_fmt.br` and the files in `runtime/` are compiled artifacts that
**embed** the software below. The sources are no longer visible in this tree -
they are inside the archive - so their licenses are reproduced here, as those
licenses require.

Built by `build/csharp_fmt/build.sh`; the versions are pinned at the top of it.

| Component | Version | License | Text |
|---|---|---|---|
| CSharpier | 1.3.0 | MIT | `csharpier-LICENSE` |
| Roslyn (`Microsoft.CodeAnalysis.CSharp`) | 5.3.0 | MIT | `dotnet-LICENSE` |
| .NET runtime and class library | 10.0.10 | MIT | `dotnet-LICENSE` |
| Emscripten | 3.1.56 | MIT / NCSA | `emscripten-LICENSE` |
| Unicode ICU data (`icudt.dat`) | ships with the above | Unicode-3.0 | `dotnet-ThirdPartyNotices` |

Roslyn and the class library share the .NET Foundation's license text because
they are released together under it.

`dotnet-ThirdPartyNotices` is the .NET SDK's own notices file, copied verbatim.
It carries the Unicode data license along with the notices for everything else
vendored into the runtime - zlib, Brotli, and the rest - so the components that
reach the artifact indirectly are covered by the text their own publisher ships
rather than by a summary written here.

## No redistribution limits

Every component is permissively licensed. Unlike this repo's Java package -
whose GraalVM artifact may only be redistributed where no fee is charged - there
is nothing here that restricts who may ship a copy or what they may charge for
it. Attribution is the only obligation, and reproducing these texts satisfies
it.

## What is not embedded

`build/csharp_fmt/build.sh` downloads the .NET SDK to produce the artifact, but
the SDK itself is not part of it and is not redistributed by this package.
Consumers need Node and nothing else.
