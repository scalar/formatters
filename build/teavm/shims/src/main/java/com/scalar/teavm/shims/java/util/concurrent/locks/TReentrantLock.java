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
 * TeaVM runs one thread, so a lock is only ever contended with itself. Holding a
 * count is enough to keep the reentrant bookkeeping honest for code that asks
 * whether it already owns the lock; there is nobody to block against.
 */
public class TReentrantLock implements TLock {
    private int holdCount;

    public TReentrantLock() {
    }

    public TReentrantLock(boolean fair) {
    }

    @Override
    public void lock() {
        ++holdCount;
    }

    @Override
    public void lockInterruptibly() {
        ++holdCount;
    }

    @Override
    public boolean tryLock() {
        ++holdCount;
        return true;
    }

    @Override
    public boolean tryLock(long time, TimeUnit unit) {
        return tryLock();
    }

    @Override
    public void unlock() {
        if (holdCount == 0) {
            throw new IllegalMonitorStateException();
        }
        --holdCount;
    }

    @Override
    public TCondition newCondition() {
        return new TSingleThreadedCondition();
    }

    public int getHoldCount() {
        return holdCount;
    }

    public boolean isHeldByCurrentThread() {
        return holdCount > 0;
    }

    public boolean isLocked() {
        return holdCount > 0;
    }

    public final boolean isFair() {
        return false;
    }

    public final boolean hasQueuedThreads() {
        return false;
    }

    public final int getQueueLength() {
        return 0;
    }
}
