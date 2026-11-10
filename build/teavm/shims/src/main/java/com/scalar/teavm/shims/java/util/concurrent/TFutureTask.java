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

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.RunnableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Runs inline. With one thread the only moment a task can execute is when
 * somebody asks for it, so run() does the work and get() hands back what it
 * produced - which is the same answer a real FutureTask gives, just sooner.
 */
public class TFutureTask<V> implements RunnableFuture<V> {
    private final Callable<V> callable;
    private V result;
    private Throwable failure;
    private boolean done;
    private boolean cancelled;

    public TFutureTask(Callable<V> callable) {
        this.callable = callable;
    }

    public TFutureTask(Runnable runnable, V result) {
        this.callable = () -> {
            runnable.run();
            return result;
        };
    }

    @Override
    public void run() {
        if (done || cancelled) {
            return;
        }
        try {
            result = callable.call();
        } catch (Throwable t) {
            failure = t;
        }
        done = true;
    }

    @Override
    public boolean cancel(boolean mayInterruptIfRunning) {
        if (done) {
            return false;
        }
        cancelled = true;
        done = true;
        return true;
    }

    @Override
    public boolean isCancelled() {
        return cancelled;
    }

    @Override
    public boolean isDone() {
        return done;
    }

    @Override
    public V get() throws ExecutionException {
        if (!done) {
            run();
        }
        if (cancelled) {
            throw new java.util.concurrent.CancellationException();
        }
        if (failure != null) {
            throw new ExecutionException(failure);
        }
        return result;
    }

    @Override
    public V get(long timeout, TimeUnit unit) throws ExecutionException {
        return get();
    }

    protected void done() {
    }

    protected void set(V v) {
        result = v;
        done = true;
    }

    protected void setException(Throwable t) {
        failure = t;
        done = true;
    }
}
