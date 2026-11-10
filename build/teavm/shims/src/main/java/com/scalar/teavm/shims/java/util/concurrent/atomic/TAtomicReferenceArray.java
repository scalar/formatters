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
package com.scalar.teavm.shims.java.util.concurrent.atomic;

import java.util.Arrays;
import java.util.function.BinaryOperator;
import java.util.function.UnaryOperator;

public class TAtomicReferenceArray<E> {
    private final Object[] array;

    public TAtomicReferenceArray(int length) {
        array = new Object[length];
    }

    public TAtomicReferenceArray(E[] array) {
        this.array = Arrays.copyOf(array, array.length, Object[].class);
    }

    public final int length() {
        return array.length;
    }

    @SuppressWarnings("unchecked")
    public final E get(int i) {
        return (E) array[i];
    }

    public final void set(int i, E newValue) {
        array[i] = newValue;
    }

    public final void lazySet(int i, E newValue) {
        array[i] = newValue;
    }

    public final E getAndSet(int i, E newValue) {
        E old = get(i);
        array[i] = newValue;
        return old;
    }

    public final boolean compareAndSet(int i, E expectedValue, E newValue) {
        if (array[i] != expectedValue) {
            return false;
        }
        array[i] = newValue;
        return true;
    }

    public final boolean weakCompareAndSet(int i, E expectedValue, E newValue) {
        return compareAndSet(i, expectedValue, newValue);
    }

    public final boolean compareAndExchange(int i, E expectedValue, E newValue) {
        return compareAndSet(i, expectedValue, newValue);
    }

    public final E getAndUpdate(int i, UnaryOperator<E> updateFunction) {
        E old = get(i);
        set(i, updateFunction.apply(old));
        return old;
    }

    public final E updateAndGet(int i, UnaryOperator<E> updateFunction) {
        E updated = updateFunction.apply(get(i));
        set(i, updated);
        return updated;
    }

    public final E getAndAccumulate(int i, E x, BinaryOperator<E> accumulatorFunction) {
        E old = get(i);
        set(i, accumulatorFunction.apply(old, x));
        return old;
    }

    public final E accumulateAndGet(int i, E x, BinaryOperator<E> accumulatorFunction) {
        E updated = accumulatorFunction.apply(get(i), x);
        set(i, updated);
        return updated;
    }

    @Override
    public String toString() {
        return Arrays.toString(array);
    }
}
