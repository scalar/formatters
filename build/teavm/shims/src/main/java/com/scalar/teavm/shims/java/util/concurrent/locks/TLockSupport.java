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
package com.scalar.teavm.shims.java.util.concurrent.locks;

/**
 * Parking the only thread would never be unparked. Unpark and the blocker
 * accessors are no-ops so that code which unparks defensively still runs.
 */
public final class TLockSupport {
    private TLockSupport() {
    }

    public static void park() {
        throw new UnsupportedOperationException("LockSupport.park would block the only thread");
    }

    public static void park(Object blocker) {
        park();
    }

    public static void parkNanos(long nanos) {
        throw new UnsupportedOperationException("LockSupport.park would block the only thread");
    }

    public static void parkNanos(Object blocker, long nanos) {
        parkNanos(nanos);
    }

    public static void parkUntil(long deadline) {
        throw new UnsupportedOperationException("LockSupport.park would block the only thread");
    }

    public static void parkUntil(Object blocker, long deadline) {
        parkUntil(deadline);
    }

    public static void unpark(Thread thread) {
    }

    public static Object getBlocker(Thread thread) {
        return null;
    }

    public static void setCurrentBlocker(Object blocker) {
    }
}
