using System.Linq;
using System.Runtime.InteropServices.JavaScript;
using CSharpier.Core;
using CSharpier.Core.CSharp;
using Microsoft.CodeAnalysis;

/// <summary>
/// The wasm module's whole surface: one function, strings in and strings out.
///
/// Everything CSharpier needs to format a file is reachable from
/// CSharpFormatter.Format, which takes a string and returns one. There is no
/// filesystem involved on the C# side, so nothing has to be mounted into the
/// module and the source being formatted never touches disk.
/// </summary>
public partial class CSharpFmt
{
    /// <summary>
    /// Formats C# source and returns the result behind a one-character status.
    ///
    /// Options arrive as separate primitives rather than an object because the
    /// JavaScript interop marshals int, bool and string natively; reading typed
    /// fields off a JSObject would cost more C# for no gain.
    ///
    /// The status character exists because a parse failure is not an exception
    /// - CSharpier returns the diagnostics on the result - and we want the
    /// caller to see the diagnostics the tool actually produced rather than a
    /// generic "could not format".
    /// </summary>
    [JSExport]
    internal static string Format(
        string source,
        int width,
        bool useTabs,
        int indentSize,
        string endOfLine
    )
    {
        var options = new CodeFormatterOptions
        {
            Width = width,
            IndentStyle = useTabs ? IndentStyle.Tabs : IndentStyle.Spaces,
            IndentSize = indentSize,
            EndOfLine = endOfLine switch
            {
                "crlf" => EndOfLine.CRLF,
                "lf" => EndOfLine.LF,
                _ => EndOfLine.Auto,
            },
        };

        var result = CSharpFormatter.Format(source, options);

        var errors = result.ErrorDiagnostics.ToList();
        return errors.Count > 0
            ? "E" + string.Join("\n", errors.Select(Describe))
            : "O" + result.Code;
    }

    /// <summary>
    /// Renders a diagnostic the way <c>Diagnostic.ToString()</c> would.
    ///
    /// Calling <c>ToString()</c> is the obvious way to do this and it traps the
    /// module: under <c>RunAOTCompilation</c> it dies with "null function or
    /// function signature mismatch", a known Mono wasm AOT problem with generic
    /// virtual dispatch. A probe build confirmed that the pieces it is built
    /// from - <c>Id</c>, <c>GetMessage()</c> and the line span - are all fine,
    /// so the string is assembled here instead of thrown away with AOT.
    ///
    /// The severity is always "error" because CSharpier filters
    /// <c>ErrorDiagnostics</c> to <c>DiagnosticSeverity.Error</c> before
    /// handing it over, so there is no other case to render.
    ///
    /// Line and character are zero-based in Roslyn and one-based in the text it
    /// prints, which is where the two increments come from.
    /// </summary>
    private static string Describe(Diagnostic diagnostic)
    {
        var start = diagnostic.Location.GetLineSpan().StartLinePosition;
        return $"({start.Line + 1},{start.Character + 1}): error {diagnostic.Id}: "
            + diagnostic.GetMessage();
    }
}

/// <summary>
/// Never runs anything. A browser-wasm project has to be an Exe for the SDK to
/// emit the JavaScript runtime and the boot manifest, and an Exe needs an entry
/// point; the module is driven entirely through the JSExport above.
/// </summary>
public static class Program
{
    public static int Main() => 0;
}
