package kfmt;

import com.facebook.ktfmt.format.Formatter;
import com.facebook.ktfmt.format.FormattingOptions;
import com.facebook.ktfmt.format.TrailingCommaManagementStrategy;
import org.teavm.jso.JSExport;

/**
 * ktfmt, as a wasm module.
 *
 * <p>Options arrive as a pipe-delimited string rather than an object because
 * that is what survives the boundary cheaply: reading typed fields off a
 * JSObject costs more Java code than splitting seven values. A field of "-"
 * means "whatever the chosen style says", so the presets stay authoritative and
 * this class never has to restate ktfmt's defaults.
 *
 * <p>Results carry a one-character status. A Java exception crossing into
 * JavaScript arrives as a proxy with no readable message, so a failure is
 * encoded instead - which is also what lets conformance.sh compare a diagnostic
 * from here against one from FormatAll.java on a JVM.
 */
public final class KtFmt {
  @JSExport
  public static String format(String source, String options) {
    try {
      return "O" + Formatter.format(parse(options), source);
    } catch (Throwable t) {
      return "E" + t.getClass().getName() + ": " + t.getMessage();
    }
  }

  /**
   * Diagnostic: formats without catching, so an unchecked failure reaches the
   * engine and the stack comes back as named wasm frames. Worth keeping - it is
   * the only way to see where inside ktfmt something went wrong. TeaVM's own
   * deobfuscator resolves every frame in this module to Throwable.&lt;init&gt;,
   * which is no better than no stack, but a module built with minifying=false
   * carries a name section that V8 reads directly.
   */
  @JSExport
  public static String formatRaw(String source, String options) {
    try {
      return Formatter.format(parse(options), source);
    } catch (com.google.googlejavaformat.java.FormatterException e) {
      // A parse error is a normal answer, not the unchecked failure this is for.
      return "parse error: " + e.getMessage();
    }
  }

  /** style|maxWidth|blockIndent|continuationIndent|trailingCommas|removeUnusedImports|preserveLambdaBreaks */
  private static FormattingOptions parse(String spec) {
    String[] parts = spec.split("\\|", -1);
    FormattingOptions options = preset(parts[0]);
    var builder = options.toBuilder();

    if (!parts[1].equals("-")) {
      builder.maxWidth(Integer.parseInt(parts[1]));
    }
    if (!parts[2].equals("-")) {
      builder.blockIndent(Integer.parseInt(parts[2]));
    }
    if (!parts[3].equals("-")) {
      builder.continuationIndent(Integer.parseInt(parts[3]));
    }
    if (!parts[4].equals("-")) {
      builder.trailingCommaManagementStrategy(strategy(parts[4]));
    }
    if (!parts[5].equals("-")) {
      builder.removeUnusedImports(parts[5].equals("1"));
    }
    if (!parts[6].equals("-")) {
      builder.preserveLambdaBreaks(parts[6].equals("1"));
    }
    return builder.build();
  }

  private static FormattingOptions preset(String style) {
    switch (style) {
      case "google":
        return Formatter.GOOGLE_FORMAT;
      case "kotlinlang":
        return Formatter.KOTLINLANG_FORMAT;
      default:
        // ktfmt's own default: "If none of the style options are passed, Meta's
        // style is used."
        return Formatter.META_FORMAT;
    }
  }

  private static TrailingCommaManagementStrategy strategy(String name) {
    switch (name) {
      case "none":
        return TrailingCommaManagementStrategy.NONE;
      case "onlyAdd":
        return TrailingCommaManagementStrategy.ONLY_ADD;
      default:
        return TrailingCommaManagementStrategy.COMPLETE;
    }
  }

  public static void main(String[] args) {
  }

  private KtFmt() {
  }
}
