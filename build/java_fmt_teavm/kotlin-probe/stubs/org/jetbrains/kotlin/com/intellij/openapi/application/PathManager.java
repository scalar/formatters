package org.jetbrains.kotlin.com.intellij.openapi.application;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Replaces IntelliJ's own PathManager for two reasons, both of which come from
 * the same place: it exists to locate an IDE installation on disk, and there
 * isn't one.
 *
 * It reaches its fallbacks through MethodHandles, including an
 * `invoke(Object)String` that cannot be declared ahead of time - polymorphic
 * signatures are an open set and Java has no way to spell two of them that
 * differ only in return type. And when it fails to find a home it throws out of
 * a static initializer, which is what made the first attempt at this look like a
 * broken parser rather than a missing directory.
 *
 * Everything here answers with a fixed in-memory path. Nothing on the parse path
 * reads a file.
 */
public final class PathManager {
  private static final String HOME = "/";
  private static final String CONFIG = "/config";
  private static final String SYSTEM = "/system";

  private PathManager() {}

  public static String getHomePath() {
    return HOME;
  }

  public static String getHomePath(boolean insideIde) {
    return HOME;
  }

  public static String getHomePathFor(Class<?> aClass) {
    return HOME;
  }

  public static Path getHomeDirFor(Class<?> aClass) {
    return Paths.get(HOME);
  }

  public static String getBinPath() {
    return HOME + "bin";
  }

  public static Path getConfigDir() {
    return Paths.get(CONFIG);
  }

  public static String getConfigPath() {
    return CONFIG;
  }

  public static String getDefaultConfigPathFor(String selector) {
    return CONFIG;
  }

  public static String getSystemPath() {
    return SYSTEM;
  }

  public static String getDefaultSystemPathFor(String selector) {
    return SYSTEM;
  }

  public static Path getIndexRoot() {
    return Paths.get(SYSTEM, "index");
  }

  public static String getResourceRoot(Class<?> context, String path) {
    return null;
  }

  public static String getCommunityHomePath() {
    return HOME;
  }

  public static String getJarPathForClass(Class<?> aClass) {
    return null;
  }

  public static Path getJarForClass(Class<?> aClass) {
    return null;
  }

  public static String getAbsolutePath(String path) {
    return path;
  }

  public static String getPluginsPath() {
    return CONFIG + "/plugins";
  }

  public static Path getPluginsDir() {
    return Paths.get(CONFIG, "plugins");
  }

  public static String getLogPath() {
    return SYSTEM + "/log";
  }

  public static Path getLogDir() {
    return Paths.get(SYSTEM, "log");
  }

  public static Path getTempDir() {
    return Paths.get(SYSTEM, "tmp");
  }
}
