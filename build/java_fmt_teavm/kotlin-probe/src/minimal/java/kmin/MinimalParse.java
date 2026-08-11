package kmin;

import org.jetbrains.kotlin.com.intellij.core.CoreApplicationEnvironment;
import org.jetbrains.kotlin.com.intellij.core.CoreProjectEnvironment;
import org.jetbrains.kotlin.com.intellij.openapi.Disposable;
import org.jetbrains.kotlin.com.intellij.psi.PsiFile;
import org.jetbrains.kotlin.com.intellij.psi.PsiFileFactory;
import org.jetbrains.kotlin.idea.KotlinFileType;
import org.jetbrains.kotlin.idea.KotlinLanguage;
import org.jetbrains.kotlin.parsing.KotlinParserDefinition;
import org.teavm.jso.JSExport;

/**
 * The narrow question: how much of the IntelliJ platform does *parsing* Kotlin
 * actually need, as opposed to KotlinCoreEnvironment, which is the compiler's
 * CLI environment and drags in classpath resolution, extension points and the
 * rest.
 *
 * If the reachable set collapses here, ktfmt's Parser could be patched onto this
 * path the same way google-java-format's reflective probes were.
 */
public final class MinimalParse {
  @JSExport
  public static String parse(String source) {
    Disposable disposable = () -> { };
    var app = new CoreApplicationEnvironment(disposable);
    app.registerFileType(KotlinFileType.INSTANCE, "kt");
    app.registerParserDefinition(new KotlinParserDefinition());
    var project = new CoreProjectEnvironment(disposable, app);

    PsiFile file = PsiFileFactory.getInstance(project.getProject())
        .createFileFromText("a.kt", KotlinLanguage.INSTANCE, source);
    return file.getClass().getName() + ":" + file.getText().length();
  }

  public static void main(String[] args) {
  }

  private MinimalParse() {
  }
}
