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

import org.teavm.extension.Autoregistered;
import org.teavm.extension.spi.substitution.SimpleSubstitutionPolicy;
import org.teavm.extension.spi.substitution.SubstitutionSink;

/**
 * Resolves {@code java.x.Y} to {@code com.scalar.teavm.shims.java.x.TY} when that class exists.
 *
 * <p>TeaVM tries substitution rules in registration order and takes the first whose target exists, and the
 * order between this policy and the class library's own is classpath order. So a shim is only safe for a class
 * upstream does not define; {@code NoShadowingTest} fails the build when upstream starts defining one.
 */
@Autoregistered
public class ShimSubstitutionPolicy extends SimpleSubstitutionPolicy {
    public static final String PACKAGE_PREFIX = "com.scalar.teavm.shims.";

    @Override
    public void contribute(SubstitutionSink sink) {
        sink.selectClasses(inPackage("java", true))
                .packagePrefix(PACKAGE_PREFIX)
                .simpleNamePrefix("T");
    }
}
