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
import java.util.Queue;

/** One thread means an ordinary deque is already "concurrent" enough. */
public class TConcurrentLinkedQueue<E> extends AbstractQueue<E> implements Queue<E> {
    private final ArrayDeque<E> items = new ArrayDeque<>();

    public TConcurrentLinkedQueue() {
    }

    public TConcurrentLinkedQueue(Collection<? extends E> c) {
        items.addAll(c);
    }

    @Override
    public boolean offer(E e) {
        return items.offer(e);
    }

    @Override
    public E poll() {
        return items.poll();
    }

    @Override
    public E peek() {
        return items.peek();
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
