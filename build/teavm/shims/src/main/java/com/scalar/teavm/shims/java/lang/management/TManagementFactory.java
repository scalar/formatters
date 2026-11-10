/*
 *  Copyright 2026 Alexey Andreev.
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
package com.scalar.teavm.shims.java.lang.management;

import java.util.List;

/**
 * Reached from IntelliJ's diagnostics, which the formatter never asks for.
 * Reporting nothing is truthful here: there is no VM to introspect.
 */
public final class TManagementFactory {
    private TManagementFactory() {
    }

    public static List<TGarbageCollectorMXBean> getGarbageCollectorMXBeans() {
        return List.of();
    }

    public static TThreadMXBean getThreadMXBean() {
        throw new UnsupportedOperationException("java.lang.management is not supported");
    }

    public static TMemoryMXBean getMemoryMXBean() {
        throw new UnsupportedOperationException("java.lang.management is not supported");
    }

    public static List<TMemoryPoolMXBean> getMemoryPoolMXBeans() {
        return List.of();
    }

    public static TRuntimeMXBean getRuntimeMXBean() {
        return RUNTIME_BEAN;
    }

    private static final TRuntimeMXBean RUNTIME_BEAN = new TRuntimeMXBean();
}
