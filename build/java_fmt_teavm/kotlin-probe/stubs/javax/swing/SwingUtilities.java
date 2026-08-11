package javax.swing;

/**
 * IntelliJ's MockApplication asks whether it is on the event dispatch thread.
 * There is no such thread, which is a real answer rather than a stubbed one.
 */
public final class SwingUtilities {
  private SwingUtilities() {}

  public static boolean isEventDispatchThread() {
    return false;
  }

  public static void invokeLater(Runnable runnable) {
    runnable.run();
  }

  public static void invokeAndWait(Runnable runnable) {
    runnable.run();
  }
}
