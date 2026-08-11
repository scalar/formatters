package org.jetbrains.kotlin.com.intellij.util;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jetbrains.kotlin.com.intellij.util.containers.ConcurrentLongObjectMap;

/**
 * IntelliJ's own is a ConcurrentHashMap clone: it takes {@code objectFieldOffset}
 * of four of its fields in its static initializer and does every update by CAS
 * on those offsets. That is not a missing implementation, it is an operation
 * with no equivalent on a managed heap - there are no field offsets to CAS.
 *
 * <p>With one thread the lock-free machinery has nothing to protect against, so
 * this is a HashMap behind the same interface. Same reasoning as the
 * {@code java.util.concurrent} stand-ins in {@code teavm-kotlin.patch}: what the
 * original buys is atomicity between threads, and there is only one.
 *
 * <p>The class is package-private upstream and reached only through
 * {@code Java11Shim.createConcurrentLongObjectMap}, which returns the interface,
 * so nothing outside this package depends on the concrete type.
 */
final class ConcurrentLongObjectHashMap<V> implements ConcurrentLongObjectMap<V> {
  private final Map<Long, V> map = new HashMap<>();

  @Override
  public V put(long key, V value) {
    return map.put(key, value);
  }

  @Override
  public V get(long key) {
    return map.get(key);
  }

  @Override
  public V remove(long key) {
    return map.remove(key);
  }

  @Override
  public V putIfAbsent(long key, V value) {
    return map.putIfAbsent(key, value);
  }

  /**
   * Copied rather than viewed. The original is weakly consistent - iterating it
   * while it changes is allowed - so callers are free to write through an
   * iteration, and a HashMap view would throw ConcurrentModificationException
   * where the original returned.
   */
  @Override
  public Iterable<LongEntry<V>> entries() {
    List<LongEntry<V>> result = new ArrayList<>(map.size());
    for (Map.Entry<Long, V> entry : map.entrySet()) {
      result.add(new Entry<>(entry.getKey(), entry.getValue()));
    }
    return result;
  }

  private static final class Entry<V> implements LongEntry<V> {
    private final long key;
    private final V value;

    Entry(long key, V value) {
      this.key = key;
      this.value = value;
    }

    @Override
    public long getKey() {
      return key;
    }

    @Override
    public V getValue() {
      return value;
    }
  }
}
