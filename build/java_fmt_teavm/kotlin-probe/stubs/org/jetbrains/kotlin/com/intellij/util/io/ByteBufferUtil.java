package org.jetbrains.kotlin.com.intellij.util.io;

import java.nio.ByteBuffer;

/** See containers/Unsafe: direct buffers and cleaners do not exist here. */
public final class ByteBufferUtil {
  public ByteBufferUtil() {}

  /** Nothing was mapped, so there is nothing to unmap. Reporting failure is honest. */
  public static boolean cleanBuffer(ByteBuffer buffer) {
    return false;
  }

  public static void copyMemory(ByteBuffer src, int srcOffset, byte[] dest, int destOffset, int length) {
    int position = src.position();
    try {
      src.position(srcOffset);
      src.get(dest, destOffset, length);
    } finally {
      src.position(position);
    }
  }
}
