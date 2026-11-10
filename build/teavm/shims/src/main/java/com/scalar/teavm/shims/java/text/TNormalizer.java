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

/**
 * Unicode normalization needs the full decomposition tables, which TeaVM does
 * not carry. The type exists so that code referring to it links; both methods
 * throw rather than return an unnormalized string, since silently doing nothing
 * would be a wrong answer rather than a missing one.
 */
public final class TNormalizer {
    private TNormalizer() {
    }

    public enum Form {
        NFD,
        NFC,
        NFKD,
        NFKC
    }

    public static String normalize(CharSequence src, Form form) {
        throw new UnsupportedOperationException("java.text.Normalizer is not supported");
    }

    public static boolean isNormalized(CharSequence src, Form form) {
        throw new UnsupportedOperationException("java.text.Normalizer is not supported");
    }
}
