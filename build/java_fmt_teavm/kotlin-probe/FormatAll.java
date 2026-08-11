import com.facebook.ktfmt.format.Formatter;
import com.facebook.ktfmt.format.FormattingOptions;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;

/**
 * Formats every .kt file under a corpus directory and writes the result - or the
 * error text - into an output directory, so two ktfmt jars can be compared file
 * by file. One JVM for the whole corpus: ktfmt's Parser holds a single
 * environment, and starting a JVM per file would dwarf the formatting.
 */
public class FormatAll {
  public static void main(String[] args) throws IOException {
    Path corpus = Paths.get(args[0]);
    Path out = Paths.get(args[1]);
    FormattingOptions options = switch (args[2]) {
      case "google" -> Formatter.GOOGLE_FORMAT;
      case "kotlinlang" -> Formatter.KOTLINLANG_FORMAT;
      default -> Formatter.META_FORMAT;
    };

    List<Path> files;
    try (Stream<Path> walk = Files.walk(corpus)) {
      files = walk.filter(p -> p.toString().endsWith(".kt")).sorted().toList();
    }

    int ok = 0, failed = 0;
    for (Path file : files) {
      String source = Files.readString(file, StandardCharsets.UTF_8);
      String result;
      try {
        result = "O" + Formatter.format(options, source);
        ok++;
      } catch (Throwable t) {
        // The message is part of the comparison: a parser swap that changed a
        // diagnostic would be a divergence too.
        result = "E" + t.getClass().getName() + ": " + t.getMessage();
        failed++;
      }
      Path target = out.resolve(corpus.relativize(file));
      Files.createDirectories(target.getParent());
      Files.writeString(target, result, StandardCharsets.UTF_8);
    }
    System.out.println(files.size() + " files, " + ok + " formatted, " + failed + " errored");
  }
}
