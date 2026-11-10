/*
 *  Copyright 2026 Scalar.
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
package com.scalar.teavm.shims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.teavm.backend.javascript.JSModuleType;
import org.teavm.tooling.ConsoleTeaVMToolLog;
import org.teavm.tooling.TeaVMProblemRenderer;
import org.teavm.tooling.TeaVMTargetType;
import org.teavm.tooling.TeaVMTool;
import shimtest.ManagementApp;

class ShimCompileTest {
    @TempDir
    Path target;

    @Test
    void compilesAndRunsProgramUsingShimmedClass() throws Exception {
        var tool = new TeaVMTool();
        tool.setTargetType(TeaVMTargetType.JAVASCRIPT);
        tool.setJsModuleType(JSModuleType.COMMON_JS);
        tool.setObfuscated(false);
        tool.setMainClass(ManagementApp.class.getName());
        tool.setTargetDirectory(target.toFile());
        tool.setClassLoader(getClass().getClassLoader());
        tool.generate();

        var problems = tool.getProblemProvider();
        if (!problems.getSevereProblems().isEmpty()) {
            TeaVMProblemRenderer.describeProblems(tool.getDependencyInfo().getCallGraph(), problems,
                    new ConsoleTeaVMToolLog(false));
        }
        assertTrue(problems.getSevereProblems().isEmpty(), "TeaVM reported errors; see the log above");

        var script = target.resolve("classes.js").toFile();
        assertTrue(script.isFile(), "no " + script);
        assertEquals("java.lang.management.ManagementFactory 0 true", runWithNode(script));
    }

    private static String runWithNode(File script) throws Exception {
        var process = new ProcessBuilder("node", "-e", "require(process.argv[1]).main([])", script.getPath())
                .redirectErrorStream(true)
                .start();
        assertTrue(process.waitFor(60, TimeUnit.SECONDS), "node timed out");
        var output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        assertEquals(0, process.exitValue(), output);
        return output;
    }
}
