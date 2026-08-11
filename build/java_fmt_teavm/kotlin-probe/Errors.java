import com.facebook.ktfmt.format.Formatter;

/** Parse-error diagnostics are part of the contract, and the corpus never hits them. */
public class Errors {
  public static void main(String[] a) {
    String[] broken = {
      "fun main() {",
      "class A { val x: = 1 }",
      "fun f(: Int) {}",
      "val x = \"unterminated",
      "@@@",
      "class",
      "fun main() { val x = 1 +++ }",
      "object O { fun f() { if (true }",
    };
    for (String source : broken) {
      String result;
      try {
        result = "OK:" + Formatter.format(source);
      } catch (Throwable t) {
        result = t.getClass().getName() + ": " + t.getMessage();
      }
      System.out.println(result.replace("\n", "\\n"));
    }
  }
}
