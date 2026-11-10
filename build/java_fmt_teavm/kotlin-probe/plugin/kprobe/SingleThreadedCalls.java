package kprobe;

import java.util.Map;
import org.teavm.model.CallLocation;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.MethodReference;
import org.teavm.model.ValueType;
import org.teavm.model.instructions.InvokeInstruction;

/**
 * Deletes the only two calls through which ktfmt reaches an {@code @Async} method, so the module
 * compiles with TeaVM's async support off, which is its default.
 *
 * <p>Both are code formatting never runs: {@code TimeoutUtil.sleep} is only called by
 * {@code PsiUtilCore.ensureValid} once a PSI element is already invalid, and the
 * {@code Thread.yield} spins in {@code WorkQueue.addLast} when a coroutine worker's queue is
 * contended. Turning async on instead would coroutine-transform about a third of the program, and
 * the module's start function would then trap on load (see README.md).
 *
 * <p>Deliberately not a blanket rewrite of every {@code sleep} and {@code yield}: a new call site
 * after a ktfmt or kotlinx-coroutines bump should fail the build, not vanish.
 */
public class SingleThreadedCalls implements ClassHolderTransformer {
  private static final MethodReference YIELD = new MethodReference(Thread.class, "yield", void.class);
  private static final MethodReference SLEEP =
      new MethodReference(Thread.class, "sleep", long.class, void.class);

  private static final Map<String, MethodReference> CALLS = Map.of(
      "kotlinx.coroutines.scheduling.WorkQueue", YIELD,
      "org.jetbrains.kotlin.com.intellij.util.containers.ConcurrentIntObjectHashMap", YIELD,
      "org.jetbrains.kotlin.com.intellij.util.TimeoutUtil", SLEEP);

  @Override
  public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
    var call = CALLS.get(cls.getName());
    if (call == null) {
      return;
    }
    var removed = 0;
    for (var method : cls.getMethods()) {
      var program = method.getProgram();
      if (program == null) {
        continue;
      }
      for (var i = 0; i < program.basicBlockCount(); ++i) {
        var insn = program.basicBlockAt(i).getFirstInstruction();
        while (insn != null) {
          var next = insn.getNext();
          if (insn instanceof InvokeInstruction invoke && invoke.getMethod().equals(call)) {
            invoke.delete();
            ++removed;
          }
          insn = next;
        }
      }
    }
    if (removed == 0) {
      var location = new CallLocation(new MethodReference(cls.getName(), "<clinit>", ValueType.VOID));
      context.getDiagnostics().warning(location, "{{m0}} is no longer called from here; drop the entry",
          call);
    }
  }
}
