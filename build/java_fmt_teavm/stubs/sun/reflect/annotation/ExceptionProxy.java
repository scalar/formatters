package sun.reflect.annotation;

/**
 * Stub. javac's AnnotationProxyMaker subclasses this to defer annotation-value
 * errors until the value is read; nothing in the formatter's path reads one,
 * because the formatter never resolves annotations. Declared so those
 * subclasses link.
 */
public abstract class ExceptionProxy implements java.io.Serializable {
  private static final long serialVersionUID = 2652411183925419334L;

  protected abstract RuntimeException generateException();
}
