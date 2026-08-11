package repro;

import org.jetbrains.kotlin.com.intellij.core.CoreApplicationEnvironment;
import org.jetbrains.kotlin.com.intellij.openapi.Disposable;
import org.teavm.jso.JSExport;

/**
 * Constructing one object from a large third-party library is enough: the module
 * TeaVM emits fails WebAssembly.compile with a branch type error, in
 * java.lang.System::getProperty - a class-library method this program never
 * calls directly.
 */
public final class Repro {
  @JSExport
  public static String run() {
    Disposable disposable = () -> { };
    return new CoreApplicationEnvironment(disposable).getClass().getName();
  }

  public static void main(String[] args) {
  }

  private Repro() {
  }
}
