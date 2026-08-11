package probe;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.NoSuchElementException;
import java.util.Spliterator;
import java.util.Spliterators;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.teavm.jso.JSExport;

/**
 * Runs the assertions from the TeaVM tests added alongside these class-library
 * changes, but on wasm-gc under Node rather than through TeaVM's JUnit runner,
 * which drives a browser this environment cannot start.
 *
 * Every case here has an identical counterpart in tests/, so what this checks is
 * exactly what CI would.
 */
public final class Probe {
  private static final StringBuilder REPORT = new StringBuilder();
  private static int failures;

  @JSExport
  public static String run() {
    REPORT.setLength(0);
    failures = 0;

    joining();
    lines();
    repeat();
    systemProperties();
    systemExit();
    lineBreakPattern();
    alphabeticPattern();
    spliterators();
    fileToPath();

    REPORT.append(failures == 0 ? "ALL PASS" : failures + " FAILURES");
    return REPORT.toString();
  }

  private static void check(String name, Object actual, Object expected) {
    boolean ok = expected == null ? actual == null : expected.equals(actual);
    if (!ok) {
      ++failures;
      REPORT.append("FAIL ").append(name).append(": got ").append(actual)
          .append(" want ").append(expected).append('\n');
    }
  }

  private static void joining() {
    check("joining/leading-empty", Stream.of("", "b").collect(Collectors.joining(",")), ",b");
    check("joining/all-empty", Stream.of("", "", "").collect(Collectors.joining(",")), ",,");
    check("joining/middle-empty", Stream.of("a", "", "b").collect(Collectors.joining(",")), "a,,b");
    check("joining/trailing-empty", Stream.of("a", "").collect(Collectors.joining(",")), "a,");
    check("joining/affixes", Stream.of("", "b").collect(Collectors.joining(",", "[", "]")), "[,b]");
    check("joining/empty-stream", Stream.<String>of().collect(Collectors.joining(",")), "");
    check("joining/single", Stream.of("a").collect(Collectors.joining(",")), "a");
  }

  private static void lines() {
    check("lines/lf", Arrays.toString("a\nb".lines().toArray()), "[a, b]");
    check("lines/crlf", Arrays.toString("a\r\nb".lines().toArray()), "[a, b]");
    check("lines/cr", Arrays.toString("a\rb".lines().toArray()), "[a, b]");
    check("lines/trailing", Arrays.toString("a\nb\n".lines().toArray()), "[a, b]");
    check("lines/leading-empty", Arrays.toString("\nb".lines().toArray()), "[, b]");
    check("lines/inner-empty", Arrays.toString("a\n\nb".lines().toArray()), "[a, , b]");
    check("lines/empty", "" + "".lines().count(), "0");
    check("lines/just-terminator", Arrays.toString("\n".lines().toArray()), "[]");
  }

  private static void repeat() {
    check("repeat/basic", new StringBuilder().repeat('a', 3).toString(), "aaa");
    check("repeat/zero", new StringBuilder("x").repeat('y', 0).toString(), "x");
    check("repeat/supplementary", "" + new StringBuilder().repeat(969356, 2).length(), "4");
    try {
      new StringBuilder().repeat('a', -1);
      check("repeat/negative", "no throw", "IllegalArgumentException");
    } catch (IllegalArgumentException e) {
      check("repeat/negative", "IllegalArgumentException", "IllegalArgumentException");
    }
  }

  private static void systemProperties() {
    for (String key : new String[] { "java.home", "user.dir", "user.home", "java.io.tmpdir" }) {
      check("property/" + key, System.getProperty(key) != null, true);
    }
  }

  private static void systemExit() {
    try {
      System.exit(0);
      check("exit", "no throw", "UnsupportedOperationException");
    } catch (UnsupportedOperationException e) {
      check("exit", "UnsupportedOperationException", "UnsupportedOperationException");
    }
  }

  private static void lineBreakPattern() {
    check("R/crlf", Arrays.toString(Pattern.compile("\\R").split("a\r\nb")), "[a, b]");
    check("R/lf", Arrays.toString(Pattern.compile("\\R").split("a\nb")), "[a, b]");
    check("R/cr", Arrays.toString(Pattern.compile("\\R").split("a\rb")), "[a, b]");
    check("R/ls", Arrays.toString(Pattern.compile("\\R").split("a\u2028b")), "[a, b]");
    check("R/double", Arrays.toString(Pattern.compile("\\R").split("a\n\nb")), "[a, , b]");
    var matcher = Pattern.compile("\\R").matcher("a\r\nb");
    check("R/find", matcher.find(), true);
    check("R/start", "" + matcher.start(), "1");
    check("R/end", "" + matcher.end(), "3");
    check("R/once", matcher.find(), false);
    check("R/quantified", Pattern.compile("a\\R+b").matcher("a\r\n\nb").matches(), true);
    check("R/no-match", Pattern.compile("\\R").matcher("a").find(), false);
    var groups = Pattern.compile("(a)\\R(b)").matcher("a\nb");
    check("R/groups-match", groups.matches(), true);
    check("R/group1", groups.group(1), "a");
    check("R/group2", groups.group(2), "b");
  }

  private static void alphabeticPattern() {
    check("alpha/ascii", Pattern.compile("\\p{IsAlphabetic}").matcher("a").matches(), true);
    check("alpha/accent", Pattern.compile("\\p{IsAlphabetic}").matcher("\u00e9").matches(), true);
    check("alpha/digit", Pattern.compile("\\p{IsAlphabetic}").matcher("1").matches(), false);
    check("alpha/space", Pattern.compile("\\p{IsAlphabetic}").matcher(" ").matches(), false);
    // \P{IsAlphabetic} is NOT asserted here. Negation is broken in TeaVM for
    // every char class built as an anonymous TAbstractCharClass overriding
    // contains(int) - \P{javaJavaIdentifierStart} fails the same way, and it
    // predates this change. Reported separately rather than fixed here.
  }

  private static void spliterators() {
    var iterator = Spliterators.iterator(Spliterators.spliterator(new Object[] { 1, 2, 3 }, 0));
    var collected = new ArrayList<>();
    while (iterator.hasNext()) {
      collected.add(iterator.next());
    }
    check("spliterators/iterator", collected.toString(), "[1, 2, 3]");

    var empty = Spliterators.iterator(Spliterators.spliterator(new Object[0], 0));
    check("spliterators/empty-hasNext", empty.hasNext(), false);
    try {
      empty.next();
      check("spliterators/empty-next", "no throw", "NoSuchElementException");
    } catch (NoSuchElementException e) {
      check("spliterators/empty-next", "NoSuchElementException", "NoSuchElementException");
    }

    var abstractSpliterator = new Spliterators.AbstractSpliterator<Integer>(3, Spliterator.SIZED) {
      private int next = 1;

      @Override
      public boolean tryAdvance(Consumer<? super Integer> action) {
        if (next > 3) {
          return false;
        }
        action.accept(next++);
        return true;
      }
    };
    check("spliterators/estimate", "" + abstractSpliterator.estimateSize(), "3");
    // SIZED implies SUBSIZED. trySplit is deliberately not asserted: the
    // contract allows null, and a JDK returns a real split here, so pinning
    // either answer would assert an implementation rather than the contract.
    check("spliterators/sized", abstractSpliterator.hasCharacteristics(Spliterator.SIZED), true);
    check("spliterators/subsized", abstractSpliterator.hasCharacteristics(Spliterator.SUBSIZED), true);
    var drained = new ArrayList<Integer>();
    abstractSpliterator.forEachRemaining(drained::add);
    check("spliterators/drain", drained.toString(), "[1, 2, 3]");
  }

  private static void fileToPath() {
    check("file/toPath", new File("/tmp/a.txt").toPath().toString(), "/tmp/a.txt");
  }

  public static void main(String[] args) {
  }

  private Probe() {
  }
}
