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

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

/** Every factory hands back the same caller-runs service. */
public final class TExecutors {
    private TExecutors() {
    }

    public static ExecutorService newSingleThreadExecutor() {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newSingleThreadExecutor(ThreadFactory threadFactory) {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newFixedThreadPool(int nThreads) {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newFixedThreadPool(int nThreads, ThreadFactory threadFactory) {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newCachedThreadPool() {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newCachedThreadPool(ThreadFactory threadFactory) {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newWorkStealingPool() {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newWorkStealingPool(int parallelism) {
        return new CallerRunsExecutorService();
    }

    public static ExecutorService newVirtualThreadPerTaskExecutor() {
        return new CallerRunsExecutorService();
    }

    public static ThreadFactory privilegedThreadFactory() {
        return defaultThreadFactory();
    }

    public static ThreadFactory defaultThreadFactory() {
        return Thread::new;
    }

    public static <T> Callable<T> callable(Runnable task, T result) {
        return () -> {
            task.run();
            return result;
        };
    }

    public static Callable<Object> callable(Runnable task) {
        return callable(task, null);
    }

    static class CallerRunsExecutorService extends TAbstractExecutorService {
        private boolean shutdown;

        @Override
        public void execute(Runnable command) {
            command.run();
        }

        @Override
        public void shutdown() {
            shutdown = true;
        }

        @Override
        public List<Runnable> shutdownNow() {
            shutdown = true;
            return List.of();
        }

        @Override
        public boolean isShutdown() {
            return shutdown;
        }

        @Override
        public boolean isTerminated() {
            return shutdown;
        }

        @Override
        public boolean awaitTermination(long timeout, TimeUnit unit) {
            return shutdown;
        }
    }
}
