package kotlinx.coroutines.internal.intellij;

/**
 * IntelliJ builds against a fork of kotlinx-coroutines that carries this; the
 * released artifact does not, so the class has to exist for ThreadContext to
 * link. Nothing on the parse path calls it.
 */
public final class IntellijCoroutines {
  public static final IntellijCoroutines INSTANCE = new IntellijCoroutines();

  private IntellijCoroutines() {}

  public kotlin.coroutines.CoroutineContext currentThreadCoroutineContext() {
    throw new UnsupportedOperationException("IntellijCoroutines is not supported");
  }
}
