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

/** See {@link TReentrantLock}: with one thread there is nothing to exclude. */
public class TReentrantReadWriteLock implements TReadWriteLock {
    private final ReadLock readLock = new ReadLock();
    private final WriteLock writeLock = new WriteLock();

    public TReentrantReadWriteLock() {
    }

    public TReentrantReadWriteLock(boolean fair) {
    }

    @Override
    public ReadLock readLock() {
        return readLock;
    }

    @Override
    public WriteLock writeLock() {
        return writeLock;
    }

    public final boolean isFair() {
        return false;
    }

    public int getReadHoldCount() {
        return readLock.getHoldCount();
    }

    public int getWriteHoldCount() {
        return writeLock.getHoldCount();
    }

    public boolean isWriteLockedByCurrentThread() {
        return writeLock.isHeldByCurrentThread();
    }

    public boolean isWriteLocked() {
        return writeLock.isLocked();
    }

    public static class ReadLock extends TReentrantLock {
    }

    public static class WriteLock extends TReentrantLock {
    }
}
