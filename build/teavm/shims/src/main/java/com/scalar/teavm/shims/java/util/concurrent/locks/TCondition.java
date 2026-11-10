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

public interface TCondition {
    void await() throws InterruptedException;

    boolean await(long time, TimeUnit unit) throws InterruptedException;

    long awaitNanos(long nanosTimeout) throws InterruptedException;

    void awaitUninterruptibly();

    boolean awaitUntil(java.util.Date deadline) throws InterruptedException;

    void signal();

    void signalAll();
}
