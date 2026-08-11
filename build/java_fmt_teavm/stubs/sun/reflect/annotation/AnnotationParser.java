package sun.reflect.annotation;

import java.lang.annotation.Annotation;
import java.util.Map;

/**
 * Stub. Reached only from javac's AnnotationProxyMaker, which materialises an
 * annotation instance for an annotation processor. The formatter runs no
 * annotation processors, so this throws rather than returning a proxy that
 * would be wrong.
 */
public class AnnotationParser {
  private AnnotationParser() {}

  public static Annotation annotationForMap(
      Class<? extends Annotation> type, Map<String, Object> memberValues) {
    throw new UnsupportedOperationException("sun.reflect.annotation.AnnotationParser");
  }
}
