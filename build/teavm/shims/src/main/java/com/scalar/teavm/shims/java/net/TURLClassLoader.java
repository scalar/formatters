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
package com.scalar.teavm.shims.java.net;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import org.teavm.classlib.java.lang.TClassLoader;
import org.teavm.classlib.java.net.TURL;

/**
 * There is no classpath to load from at run time - everything reachable was
 * linked into the module - so this exists to give code that constructs one
 * something to construct. Loading through it finds nothing.
 */
public class TURLClassLoader extends TClassLoader implements Closeable {
    private final TURL[] urls;

    public TURLClassLoader(TURL[] urls) {
        this(urls, null);
    }

    public TURLClassLoader(TURL[] urls, TClassLoader parent) {
        super(parent);
        this.urls = urls.clone();
    }

    public TURL[] getURLs() {
        return urls.clone();
    }

    public static TURLClassLoader newInstance(TURL[] urls) {
        return new TURLClassLoader(urls);
    }

    public static TURLClassLoader newInstance(TURL[] urls, TClassLoader parent) {
        return new TURLClassLoader(urls, parent);
    }

    public TURL findResource(String name) {
        return null;
    }

    @Override
    public InputStream getResourceAsStream(String name) {
        TClassLoader parent = getParent();
        return parent != null ? parent.getResourceAsStream(name) : null;
    }

    @Override
    public void close() throws IOException {
    }
}
