/*
 *  Copyright 2026 Scalar.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
package com.scalar.teavm.shims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * A shim must name a class the TeaVM class library does not define. If upstream adds one, which of the two the
 * compiler picks depends on classpath order, so the shim has to go: delete it and the classes only it used.
 */
class NoShadowingTest {
    private static final String CLASSLIB_PREFIX = "org.teavm.classlib.";

    @Test
    void noShimDuplicatesAClassLibraryClass() throws IOException {
        var root = Path.of(ShimSubstitutionPolicy.class.getProtectionDomain().getCodeSource().getLocation().getPath());
        var shimRoot = root.resolve(ShimSubstitutionPolicy.PACKAGE_PREFIX.replace('.', '/'));
        List<String> shims;
        try (var files = Files.walk(shimRoot.resolve("java"))) {
            shims = files.map(shimRoot::relativize)
                    .map(Path::toString)
                    .filter(name -> name.endsWith(".class") && !name.contains("$"))
                    .map(name -> name.substring(0, name.length() - ".class".length()).replace('/', '.'))
                    .sorted()
                    .collect(Collectors.toList());
        }
        assertTrue(shims.size() > 0, "found no shims under " + shimRoot);

        var loader = getClass().getClassLoader();
        var shadowed = shims.stream()
                .filter(name -> loader.getResource((CLASSLIB_PREFIX + name).replace('.', '/') + ".class") != null)
                .collect(Collectors.toList());
        assertEquals(List.of(), shadowed, "upstream TeaVM now defines these; delete the shims");
    }
}
