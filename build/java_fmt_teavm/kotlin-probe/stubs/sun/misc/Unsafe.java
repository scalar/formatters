package sun.misc;

/**
 * IntelliJ's ReflectionUtil looks this class up by name in its static
 * initializer, reads {@code theUnsafe} off it reflectively, and throws if the
 * result is null - so the whole platform is unreachable without it. TeaVM has no
 * {@code sun.misc}, and this is not a {@code java.*} class, so it comes from the
 * classpath rather than the class library.
 *
 * <p>The field is all that is needed. Nothing on the parse path calls a method
 * on the result: ReflectionUtil stores it as a plain Object and only reaches
 * through it on paths that do off-heap work, none of which parsing takes. A
 * method added here would be a guess about which one, so there are none - a
 * missing method fails loudly at the call rather than quietly returning a wrong
 * answer.
 *
 * <p>Being found by {@code Class.forName} and having a readable field are both
 * things TeaVM has to be told about at build time; see
 * {@code plugin/KotlinProbeReflectionPolicy.java}.
 */
public final class Unsafe {
  private static final Unsafe theUnsafe = new Unsafe();

  private Unsafe() {}
}
