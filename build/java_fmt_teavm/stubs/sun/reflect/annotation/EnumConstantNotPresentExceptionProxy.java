package sun.reflect.annotation;

/** Stub. See {@link ExceptionProxy}. */
public class EnumConstantNotPresentExceptionProxy extends ExceptionProxy {
  private static final long serialVersionUID = -604662101303187330L;

  private final Class<? extends Enum<?>> enumType;
  private final String constName;

  public EnumConstantNotPresentExceptionProxy(Class<? extends Enum<?>> enumType, String constName) {
    this.enumType = enumType;
    this.constName = constName;
  }

  @Override
  protected RuntimeException generateException() {
    return new EnumConstantNotPresentException(enumType, constName);
  }

  @Override
  public String toString() {
    return constName + " /* Warning: constant not present! */";
  }
}
