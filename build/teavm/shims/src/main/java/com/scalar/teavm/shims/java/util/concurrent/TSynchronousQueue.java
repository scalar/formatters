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
package com.scalar.teavm.shims.java.util.concurrent;

import java.util.AbstractQueue;
import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Iterator;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * A blocking queue whose blocking operations cannot block: with one thread,
 * waiting for another to produce or consume would never return. They throw
 * instead, so a program that depends on real concurrency fails loudly rather
 * than hanging.
 */
public class TSynchronousQueue<E> extends AbstractQueue<E> implements BlockingQueue<E> {
    private final ArrayDeque<E> items = new ArrayDeque<>();

    public TSynchronousQueue() {
    }

    public TSynchronousQueue(int capacity) {
    }

    public TSynchronousQueue(boolean fair) {
    }

    @Override
    public boolean offer(E e) {
        return items.offer(e);
    }

    @Override
    public boolean offer(E e, long timeout, TimeUnit unit) {
        return offer(e);
    }

    @Override
    public void put(E e) {
        items.add(e);
    }

    @Override
    public E poll() {
        return items.poll();
    }

    @Override
    public E poll(long timeout, TimeUnit unit) {
        return items.poll();
    }

    @Override
    public E take() {
        E head = items.poll();
        if (head == null) {
            throw new UnsupportedOperationException("take would block the only thread");
        }
        return head;
    }

    @Override
    public E peek() {
        return items.peek();
    }

    @Override
    public int remainingCapacity() {
        return Integer.MAX_VALUE;
    }

    @Override
    public int drainTo(Collection<? super E> c) {
        return drainTo(c, Integer.MAX_VALUE);
    }

    @Override
    public int drainTo(Collection<? super E> c, int maxElements) {
        int drained = 0;
        while (drained < maxElements && !items.isEmpty()) {
            c.add(items.poll());
            ++drained;
        }
        return drained;
    }

    @Override
    public Iterator<E> iterator() {
        return items.iterator();
    }

    @Override
    public int size() {
        return items.size();
    }
}
