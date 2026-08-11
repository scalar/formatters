package javax.management;

/**
 * Declared by IntelliJ's low-memory watcher. Never registered here - there is no
 * MBean server to register with - but the interface has to exist, because a
 * class that declares an interface the compiler never reached produces an
 * ill-typed module rather than a diagnostic.
 */
public interface NotificationListener {
  void handleNotification(Object notification, Object handback);
}
