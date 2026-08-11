package javafmt;

import com.google.googlejavaformat.java.Formatter;
import com.google.googlejavaformat.java.ImportOrderer;
import com.google.googlejavaformat.java.JavaFormatterOptions;
import com.google.googlejavaformat.java.RemoveUnusedImports;
import com.google.googlejavaformat.java.StringWrapper;
import org.teavm.jso.JSExport;

/**
 * The wasm module's entry point: exports one function that formats a source
 * string with google-java-format.
 *
 * Unlike the GraalVM Web Image build, TeaVM implements {@code @JSExport}, so the
 * function is a real module export rather than something parked on globalThis by
 * a bootstrap.
 *
 * Results are prefixed with a status character rather than thrown. A Java
 * exception crossing the boundary reaches JavaScript as a proxy object, not an
 * Error - it has no message property - so the JavaScript side could not report
 * what went wrong.
 */
public final class JavaFmt {
  private static final char OK = 'O';
  private static final char ERROR = 'E';

  /**
   * Formats one file the way the google-java-format CLI does.
   *
   * {@code options} is "style|sortImports|removeUnusedImports|reflowLongStrings"
   * - a delimited string rather than an object because reading typed fields back
   * out of one costs more code on this side than parsing four values.
   *
   * The steps and their order are FormatFileCallable's, because the reference
   * this package claims to be is the tool, not the Formatter class. Calling
   * formatSource alone leaves imports untouched and text blocks unreflowed, and
   * the conformance test sees that immediately as a divergence.
   */
  @JSExport
  public static String format(String source, String options) {
    try {
      String[] parts = options.split("\\|", -1);
      JavaFormatterOptions.Style style =
          parts[0].equals("aosp")
              ? JavaFormatterOptions.Style.AOSP
              : JavaFormatterOptions.Style.GOOGLE;

      Formatter formatter = new Formatter(JavaFormatterOptions.builder().style(style).build());
      String output = formatter.formatSource(source);
      if (parts[2].equals("1")) {
        output = RemoveUnusedImports.removeUnusedImports(output);
      }
      if (parts[1].equals("1")) {
        output = ImportOrderer.reorderImports(output, style);
      }
      if (parts[3].equals("1")) {
        output = StringWrapper.wrap(output, formatter);
      }
      return OK + output;
    } catch (Throwable t) {
      String message = t.getMessage();
      return ERROR + (message == null ? t.toString() : message);
    }
  }

  public static void main(String[] args) {
  }

  private JavaFmt() {
  }
}
