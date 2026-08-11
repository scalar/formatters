package jdk.internal.jmod;

import java.io.IOException;
import java.nio.file.Path;

/**
 * Stub. javac's Locations walks a module path looking for .jmod files; the
 * formatter sets an empty platform class path and never gives it a module path,
 * so nothing calls this. Declared so Locations links.
 */
public class JmodFile {
  private JmodFile() {}

  public static void checkMagic(Path file) throws IOException {
    throw new UnsupportedOperationException("jdk.internal.jmod.JmodFile");
  }
}
