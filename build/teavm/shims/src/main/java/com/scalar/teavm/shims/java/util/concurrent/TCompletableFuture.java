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

import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Completes eagerly. Nothing else can be running to complete it later, so every
 * dependent stage runs the moment it is attached.
 */
public class TCompletableFuture<T> {
    private T value;
    private Throwable failure;
    private boolean done;

    public TCompletableFuture() {
    }

    public static <U> TCompletableFuture<U> completedFuture(U value) {
        var future = new TCompletableFuture<U>();
        future.complete(value);
        return future;
    }

    public static <U> TCompletableFuture<U> failedFuture(Throwable ex) {
        var future = new TCompletableFuture<U>();
        future.completeExceptionally(ex);
        return future;
    }

    public static TCompletableFuture<Void> runAsync(Runnable runnable) {
        runnable.run();
        return completedFuture(null);
    }

    public static TCompletableFuture<Void> runAsync(Runnable runnable, java.util.concurrent.Executor executor) {
        executor.execute(runnable);
        return completedFuture(null);
    }

    public static <U> TCompletableFuture<U> supplyAsync(Supplier<U> supplier) {
        return completedFuture(supplier.get());
    }

    public boolean complete(T value) {
        if (done) {
            return false;
        }
        this.value = value;
        done = true;
        return true;
    }

    public boolean completeExceptionally(Throwable ex) {
        if (done) {
            return false;
        }
        failure = ex;
        done = true;
        return true;
    }

    public boolean isDone() {
        return done;
    }

    public boolean isCompletedExceptionally() {
        return failure != null;
    }

    public boolean isCancelled() {
        return false;
    }

    public boolean cancel(boolean mayInterruptIfRunning) {
        return false;
    }

    public T get() throws ExecutionException {
        return join0(true);
    }

    public T get(long timeout, TimeUnit unit) throws ExecutionException {
        return join0(true);
    }

    public T join() {
        try {
            return join0(false);
        } catch (ExecutionException e) {
            throw new CompletionException(e.getCause());
        }
    }

    public T getNow(T valueIfAbsent) {
        return done ? value : valueIfAbsent;
    }

    private T join0(boolean checked) throws ExecutionException {
        if (!done) {
            throw new UnsupportedOperationException("waiting would block the only thread");
        }
        if (failure != null) {
            if (checked) {
                throw new ExecutionException(failure);
            }
            throw new CompletionException(failure);
        }
        return value;
    }

    public <U> TCompletableFuture<U> thenApply(Function<? super T, ? extends U> fn) {
        if (failure != null) {
            return failedFuture(failure);
        }
        return completedFuture(fn.apply(value));
    }

    public TCompletableFuture<Void> thenAccept(java.util.function.Consumer<? super T> action) {
        if (failure == null) {
            action.accept(value);
        }
        var future = new TCompletableFuture<Void>();
        future.done = true;
        future.failure = failure;
        return future;
    }

    public TCompletableFuture<T> whenComplete(BiConsumer<? super T, ? super Throwable> action) {
        action.accept(value, failure);
        return this;
    }

    public <U> TCompletableFuture<U> handle(BiFunction<? super T, Throwable, ? extends U> fn) {
        return completedFuture(fn.apply(value, failure));
    }
}
