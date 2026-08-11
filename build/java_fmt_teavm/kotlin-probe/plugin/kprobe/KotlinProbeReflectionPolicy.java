package kprobe;

import org.teavm.extension.spi.reflection.SimpleReflectionPolicy;

/**
 * A TeaVM build-time extension, not part of the compiled program.
 *
 * TeaVM resolves reflection statically: a class is only findable by
 * {@code Class.forName} if something says so at build time, and
 * {@code getDeclaredFields} returns an empty array unless the fields were marked
 * accessible. Both defaults are right - they are what keeps the whole class
 * library from being retained - but IntelliJ's ReflectionUtil needs the one
 * exception, and its static initializer throws without it.
 *
 * Scoped to exactly that one class. Widening this to, say, every class the
 * platform reflects over would pull their fields into the module and defeat the
 * point of the analysis.
 */
public class KotlinProbeReflectionPolicy extends SimpleReflectionPolicy {
  @Override
  protected void setup() {
    selectClass("sun.misc.Unsafe")
        .foundByName()
        .reflectableFields(named("theUnsafe"));

    // Kotlin's PSI element types resolve their provider the same way an SPI
    // would, but by hand: forName the impl, read its INSTANCE field, and throw
    // if it is not there. KtNodeTypes' class initializer does this, so nothing
    // parses without it.
    selectClass("org.jetbrains.kotlin.psi.impl.KotlinElementTypeProviderImpl")
        .foundByName()
        .reflectableFields(named("INSTANCE"));

    // EventDispatcher.getMulticaster hands its listener interface to
    // Proxy.newProxyInstance, and TeaVM generates proxy classes at build time -
    // an unregistered interface list is a SecurityException at run time, not a
    // generated class. Two things proxy here: EventDispatcher, whose rule is
    // "extends EventListener", and MessageBus, whose listener is the type
    // parameter of a Topic and so is not visible to a build-time rule at all.
    // The name is: IntelliJ calls these *Listener without exception, and a
    // convention is a better selector than a list of the ones reached today,
    // which would need extending every time the parse path moves. Only
    // reachable interfaces cost anything.
    // The generated proxy resolves each method it forwards through
    // getDeclaredMethod at class-initialization time, so the methods have to be
    // reflectable too or the proxy throws NoSuchMethodException before any
    // listener is ever dispatched to.
    selectClasses(INTERFACE.and(extending("java.util.EventListener")
            .or(namePattern("**Listener"))))
        .proxyable()
        .reflectablePublicMethods();

    // Element types take the
    // PSI class they build and look up its (ASTNode) constructor, plus a (StubT)
    // one for the stub kind, in their own constructors. They refuse to
    // initialize if either is missing, so this is not a lazily reached path but
    // the first thing KtNodeTypes does. KtElement is the bound both declarations
    // use, which makes it the honest selector rather than an enumeration of
    // today's element types.
    selectClasses(extending("org.jetbrains.kotlin.psi.KtElement"))
        .reflectableMethods(named("<init>"));
    // KDocElementType is the third kind. Its declared bound is PsiElement, which
    // as a selector would pull in the whole platform, but it is only ever handed
    // the KDoc PSI - eight classes, two of which are KtElement subclasses the
    // rule above already covers.
    selectPackage("org.jetbrains.kotlin.kdoc.psi", true)
        .reflectableMethods(named("<init>"));

    // The platform's DI container builds a registered service by picking the
    // greediest satisfiable constructor, so anything it constructs needs its
    // constructors visible. The ones it constructs here are the extension-point
    // singletons - LanguageSubstitutors and its siblings - which are all
    // KeyedExtensionCollector subclasses.
    //
    // Scoped to that supertype rather than to the platform's package: a
    // reflectable constructor is a root, so a package-wide rule makes every
    // class in it reachable, which here meant dragging in the XML stream
    // readers and kotlinx.serialization and failing to compile at all.
    selectClasses(extending("org.jetbrains.kotlin.com.intellij.openapi.util.KeyedExtensionCollector"))
        .reflectableMethods(named("<init>"));
  }
}
