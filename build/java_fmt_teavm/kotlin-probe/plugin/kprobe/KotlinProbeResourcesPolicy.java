package kprobe;

import java.util.Collection;
import org.teavm.extension.spi.resources.DefaultResourcesPolicy;

/**
 * Resources are not on the classpath at run time, so TeaVM only embeds the ones
 * a build-time policy names.
 *
 * IntelliJ's Registry reads misc/registry.properties as a classpath stream and
 * throws MissingResourceException for any key it cannot find, with no default -
 * PsiManager asks for psi.sleep.in.validity.check on the first PSI access, so
 * nothing parses without it. The override file is optional upstream and absent
 * here; Registry probes for it and accepts its absence.
 */
public class KotlinProbeResourcesPolicy extends DefaultResourcesPolicy {
  @Override
  public String[] supplyResources(Collection<? extends String> availableClassNames) {
    return new String[] { "misc/registry.properties" };
  }
}
