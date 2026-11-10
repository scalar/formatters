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
package com.scalar.teavm.shims.java.text;

import org.teavm.classlib.java.text.TCharacterIterator;
import org.teavm.classlib.java.util.TLocale;

/**
 * Boundary analysis needs the locale break rules, which TeaVM does not carry,
 * so this declares the type without implementing it: the abstract methods let
 * code that holds a reference link, and the factories throw rather than hand
 * back an instance that would segment text incorrectly.
 */
public abstract class TBreakIterator implements Cloneable {
    public static final int DONE = -1;

    protected TBreakIterator() {
    }

    public abstract int first();

    public abstract int last();

    public abstract int next(int n);

    public abstract int next();

    public abstract int previous();

    public abstract int following(int offset);

    public abstract int current();

    public abstract TCharacterIterator getText();

    public abstract void setText(TCharacterIterator newText);

    public int preceding(int offset) {
        int pos = following(offset);
        while (pos >= offset && pos != DONE) {
            pos = previous();
        }
        return pos;
    }

    public boolean isBoundary(int offset) {
        if (offset == 0) {
            return true;
        }
        return following(offset - 1) == offset;
    }

    public void setText(String newText) {
        throw new UnsupportedOperationException("java.text.BreakIterator is not supported");
    }

    @Override
    public Object clone() {
        try {
            return super.clone();
        } catch (CloneNotSupportedException e) {
            throw new InternalError(e);
        }
    }

    public static TBreakIterator getWordInstance() {
        return getWordInstance(TLocale.getDefault());
    }

    public static TBreakIterator getWordInstance(TLocale locale) {
        throw new UnsupportedOperationException("java.text.BreakIterator is not supported");
    }

    public static TBreakIterator getLineInstance() {
        return getLineInstance(TLocale.getDefault());
    }

    public static TBreakIterator getLineInstance(TLocale locale) {
        throw new UnsupportedOperationException("java.text.BreakIterator is not supported");
    }

    public static TBreakIterator getCharacterInstance() {
        return getCharacterInstance(TLocale.getDefault());
    }

    public static TBreakIterator getCharacterInstance(TLocale locale) {
        throw new UnsupportedOperationException("java.text.BreakIterator is not supported");
    }

    public static TBreakIterator getSentenceInstance() {
        return getSentenceInstance(TLocale.getDefault());
    }

    public static TBreakIterator getSentenceInstance(TLocale locale) {
        throw new UnsupportedOperationException("java.text.BreakIterator is not supported");
    }

    public static TLocale[] getAvailableLocales() {
        return new TLocale[0];
    }
}
