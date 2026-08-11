import com.google.googlejavaformat.java.Formatter;
import com.google.googlejavaformat.java.ImportOrderer;
import com.google.googlejavaformat.java.JavaFormatterOptions;
import com.google.googlejavaformat.java.RemoveUnusedImports;
import com.google.googlejavaformat.java.StringWrapper;
import java.util.function.BiFunction;
import org.graalvm.webimage.api.JS;
import org.graalvm.webimage.api.JSString;

/**
 * The wasm module's entry point: hands JavaScript a function that formats one
 * source string with google-java-format.
 *
 * Web Image has no @JS.Export yet, so the only way to give JavaScript a callable
 * is to pass a functional interface into a native @JS method and let its body
 * park it on globalThis. main() runs once at boot and does nothing else; the
 * module stays alive because JavaScript holds a reference to the lambda.
 *
 * Results are prefixed with a status character rather than thrown. A Java
 * exception crossing the boundary reaches JavaScript as a Java proxy object,
 * not an Error - it has no message property and Object.getOwnPropertyNames on
 * it throws - so the JavaScript side could not report what went wrong.
 */
public final class JavaFmt {
  private static final char OK = 'O';
  private static final char ERROR = 'E';

  @JS(args = {"format"}, value = "globalThis.__javaFmtFormat = format;")
  private static native void exportFormat(BiFunction<JSString, JSString, JSString> format);

  public static void main(String[] args) {
    exportFormat((source, options) -> JSString.of(format(source.asString(), options.asString())));
  }

  /**
   * Formats one file the way the google-java-format CLI does.
   *
   * {@code options} is "style|sortImports|removeUnusedImports|reflowLongStrings"
   * - a delimited string rather than a JSObject because reading typed fields
   * back out of one costs more code on this side than parsing four values.
   *
   * The steps and their order are FormatFileCallable's, because the reference
   * this package claims to be is the tool, not the Formatter class. Calling
   * formatSource alone leaves imports untouched and text blocks unreflowed, and
   * the conformance test sees that immediately as a divergence.
   */
  private static String format(String source, String options) {
    String[] parts = options.split("\\|", -1);
    boolean aosp = parts[0].equals("aosp");
    JavaFormatterOptions.Style style =
        aosp ? JavaFormatterOptions.Style.AOSP : JavaFormatterOptions.Style.GOOGLE;

    try {
      Formatter formatter =
          new Formatter(JavaFormatterOptions.builder().style(style).build());
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

  private JavaFmt() {}
}
