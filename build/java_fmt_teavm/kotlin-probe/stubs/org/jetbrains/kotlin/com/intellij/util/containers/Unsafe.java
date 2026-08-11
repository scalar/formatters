package org.jetbrains.kotlin.com.intellij.util.containers;

import java.lang.reflect.Field;

/**
 * Replaces IntelliJ's own sun.misc.Unsafe shim, which reaches every operation
 * through a MethodHandle looked up by name - the one construct an ahead-of-time
 * compiler cannot resolve.
 *
 * These are raw memory operations against field offsets, and there is no
 * equivalent on a managed heap, so they throw. What that means in practice is
 * that the containers built on them (WeakList, ConcurrentIntObjectHashMap) fail
 * loudly if the parse path reaches them, rather than corrupting state quietly.
 * Whether it does is the question this probe answers.
 */
public final class Unsafe {
  private Unsafe() {}

  private static RuntimeException unsupported() {
    return new UnsupportedOperationException("sun.misc.Unsafe has no equivalent on a managed heap");
  }

  public static boolean compareAndSwapInt(Object o, long offset, int expected, int value) {
    throw unsupported();
  }

  public static boolean compareAndSwapLong(Object o, long offset, long expected, long value) {
    throw unsupported();
  }

  public static int getAndAddInt(Object o, long offset, int delta) {
    throw unsupported();
  }

  public static Object getObjectVolatile(Object o, long offset) {
    throw unsupported();
  }

  public static boolean compareAndSwapObject(Object o, long offset, Object expected, Object value) {
    throw unsupported();
  }

  public static void putObjectVolatile(Object o, long offset, Object value) {
    throw unsupported();
  }

  public static long objectFieldOffset(Field field) {
    throw unsupported();
  }

  public static int arrayIndexScale(Class<?> type) {
    throw unsupported();
  }

  public static int arrayBaseOffset(Class<?> type) {
    throw unsupported();
  }

  public static void copyMemory(Object src, long srcOffset, Object dest, long destOffset, long length) {
    throw unsupported();
  }
}
