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

import java.util.concurrent.TimeUnit;

/**
 * Waiting for a signal that only another thread could send would deadlock, so
 * awaiting throws rather than hanging. Signalling is a no-op: there is nothing
 * waiting.
 */
class TSingleThreadedCondition implements TCondition {
    @Override
    public void await() {
        throw new UnsupportedOperationException("Condition.await would block the only thread");
    }

    @Override
    public boolean await(long time, TimeUnit unit) {
        throw new UnsupportedOperationException("Condition.await would block the only thread");
    }

    @Override
    public long awaitNanos(long nanosTimeout) {
        throw new UnsupportedOperationException("Condition.await would block the only thread");
    }

    @Override
    public void awaitUninterruptibly() {
        throw new UnsupportedOperationException("Condition.await would block the only thread");
    }

    @Override
    public boolean awaitUntil(java.util.Date deadline) {
        throw new UnsupportedOperationException("Condition.await would block the only thread");
    }

    @Override
    public void signal() {
    }

    @Override
    public void signalAll() {
    }
}
