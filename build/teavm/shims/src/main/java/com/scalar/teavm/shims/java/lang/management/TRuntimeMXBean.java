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
import java.util.Map;

/**
 * The two time questions have real answers here - the module has a start and a
 * current time - so they are answered. Everything else describes a launcher that
 * does not exist: there is no command line, no class path and no VM name to
 * report, and inventing one would be a wrong answer rather than a missing one.
 */
public class TRuntimeMXBean {
    private static final long START_TIME = System.currentTimeMillis();

    public long getStartTime() {
        return START_TIME;
    }

    public long getUptime() {
        return System.currentTimeMillis() - START_TIME;
    }

    public List<String> getInputArguments() {
        return List.of();
    }

    public Map<String, String> getSystemProperties() {
        return Map.of();
    }

    public String getName() {
        throw unsupported();
    }

    public String getVmName() {
        throw unsupported();
    }

    public String getVmVendor() {
        throw unsupported();
    }

    public String getVmVersion() {
        throw unsupported();
    }

    public String getSpecName() {
        throw unsupported();
    }

    public String getSpecVendor() {
        throw unsupported();
    }

    public String getSpecVersion() {
        throw unsupported();
    }

    public String getManagementSpecVersion() {
        throw unsupported();
    }

    public String getClassPath() {
        throw unsupported();
    }

    public String getLibraryPath() {
        throw unsupported();
    }

    public String getBootClassPath() {
        throw unsupported();
    }

    public boolean isBootClassPathSupported() {
        return false;
    }

    private static RuntimeException unsupported() {
        return new UnsupportedOperationException("java.lang.management is not supported");
    }
}
