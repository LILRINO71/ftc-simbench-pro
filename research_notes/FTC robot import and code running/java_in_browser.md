# Running real FTC team Java OpModes in a browser-only web app

Scope: how FTC SimBench Pro (static site on Cloudflare Pages, no server) can run teams' unmodified Java, including hardware kept in Robot/subsystem classes, FTCLib command-based OpModes, Road Runner 1.0 / 0.5 and Pedro Pathing. Researched 2026-10-02. "Measured locally" means measured in this research session on the cited artifact; the numbers are reproducible.

Baseline in this repo: `src/java.js` (734 lines) is the regex statement parser. `src/roadrunner.js` (497 lines) already re-implements RR 1.0 path building and following in JS. `package.json` is `"license": "UNLICENSED"`, `"private": true`. The repo's own team code (`assets/robots/into-the-deep/*.java` + `tests/fixtures/CompetitionTeleOp.java`, 1,642 lines) has 17 `implements Action` classes, 21 `try`, 31 `static`, 4 `extends` and 2 method references (`::`). It has no lambdas, enums or switch.

## 1. Running real JVM bytecode in the browser (CheerpJ, Doppio, TeaVM, JWebAssembly, GraalVM Web Image, Bytecoder)

### Takeaway
Only two options are live and practical in 2026: **CheerpJ 4.x**, a full OpenJDK JVM in WASM with an interpreter and JIT that is commercial but free to individuals and FOSS on its CDN, and **TeaVM**, an Apache-2.0 AOT compiler that now also has an in-browser javac+TeaVM WASM build. Doppio is dead (last commit 2021). GraalVM Web Image is experimental and build-time only. JWebAssembly and Bytecoder are AOT tools that need a build step and are not viable for compiling team code on the fly.

### Cited Findings
**CheerpJ: versions and capabilities**
- CheerpJ 4.0 was released **April 23, 2025**. It is the first version to support Java 8 and Java 11 together, and it adds WebAssembly JNI modules "loaded and executed dynamically". The post gives no benchmark numbers, only that the Minecraft demo "can now run with satisfactory performance on most mid range machines." — [CheerpJ 4.0 blog](https://labs.leaningtech.com/blog/cheerpj-4.0)
- Java 17 shipped early as a *preview* in CheerpJ 4.1. Stable Java 17 was planned for CheerpJ 5.0 "before the end of 2025", with "LTS parity by the end of 2026" (Java 25). This comes from search-result snippets of the 4.1 post and the roadmap; the roadmap page itself returned 404. — [CheerpJ 4.1 blog](https://labs.leaningtech.com/blog/cheerpj-4.1.html), [CheerpJ 4.0 blog](https://labs.leaningtech.com/blog/cheerpj-4.0)
- The current version is **4.3**. The licensing page names v4.3, and JavaFiddle loads `https://cjrtnc.leaningtech.com/4.3/loader.js`. — [CheerpJ licensing](https://cheerpj.com/docs/licensing); [JavaFiddle src/app.html](https://github.com/leaningtech/javafiddle)
- Execution model: "The Java byte code runs within an interpreter. Then this byte code is Just-In-Time compiled to optimized JavaScript", with inlining and devirtualization. — [CheerpJ architecture](https://cheerpj.com/docs/explanation/architecture)
- "CheerpJ supports multiple processes and threads… Synchronization features are supported." The post does not describe the mechanism. CheerpJ was stress-tested on IntelliJ IDEA 2019 (~400 MB of JARs). — [CheerpJ 3 deep dive](https://labs.leaningtech.com/blog/cheerpj-3-deep-dive)
- JS→Java interop: `cheerpjRunLibrary("/app/example.jar")` returns a proxy, and every Java call is `await`ed, e.g. `const ex = await new Example(); await ex.hello();`. A filesystem API (`cheerpOSAddStringFile`) adds files at runtime. — [cheerpjRunLibrary reference](https://cheerpj.com/docs/reference/cheerpjRunLibrary); [CheerpJ architecture](https://cheerpj.com/docs/explanation/architecture)

**CheerpJ: licensing (as of 2026)**
- The free Community License covers "Individuals, including one-person companies" (personal and commercial), "Free and Open-Source Software (FOSS) projects", and technical evaluations. — [CheerpJ licensing](https://cheerpj.com/docs/licensing)
- A **commercial license is required** for multi-person companies, for "Self-hosting of the CheerpJ Core component", for redistribution/OEM, and for internal employee apps. Education and non-profits must "Contact us for a special quote". No prices are published. — [CheerpJ licensing](https://cheerpj.com/docs/licensing)
- The Community License allows "unlimited, unmetered use of CheerpJ from the `cjrtnc.leaningtech.com` domain". The runtime must come from Leaning Tech's CDN unless commercially licensed. — [CheerpJ licensing](https://cheerpj.com/docs/licensing)
- Leaning Tech's own wording: "CheerpJ is commercial software, but it's free to use for FOSS projects, personal projects and one-person companies." — [CheerpJ 4.0 blog](https://labs.leaningtech.com/blog/cheerpj-4.0)

**TeaVM**
- TeaVM is an AOT bytecode→JS/WASM compiler. It is actively maintained (last commit 2026-10-01) and Apache-2.0 licensed. — [konsoletyper/teavm](https://github.com/konsoletyper/teavm)
- TeaVM 0.13.0 added coroutine (thread) support to the WebAssembly GC backend, Java 25 support, SharedArrayBuffer/imported memory, and an in-browser Java→WASM compiler (the playground). — [TeaVM 0.13.0 release notes](https://teavm.org/docs/release-notes/0.13.0.html)

**Others**
- **Doppio** (a JVM written in TypeScript, MIT, Java 8, "research project"): last commit **2021-08-04**, a dependabot merge, so it is effectively abandoned. — [plasma-umass/doppio](https://github.com/plasma-umass/doppio) (commit date read from git in this session)
- **GraalVM Web Image** takes a JVM app, AOT-compiles it with Native Image (`--tool:svm-wasm`) and outputs WASM plus a JS wrapper. It needs Oracle GraalVM 25.1+ and "is experimental and under active development". It is a build-time native-image toolchain, not something that runs in the browser. — [GraalVM Web Image docs](https://www.graalvm.org/dev/reference-manual/web-image/); [The New Stack](https://thenewstack.io/graalvm-finally-gets-java-for-webassembly/)
- **JWebAssembly**: last commit 2026-10-01 ("remove dead code"). **Bytecoder**: last commit 2026-08-08, a dependabot config change. Both are AOT bytecode→WASM/JS tools that need a JVM at build time. — [JWebAssembly](https://github.com/i-net-software/JWebAssembly); [Bytecoder](https://github.com/mirkosertic/Bytecoder)

### Inferences
- **CheerpJ license fit:** SimBench Pro is committed by one individual (LILRINO71) and is not FOSS-licensed (`UNLICENSED`), so it would fall under the "individual" clause, using the CDN only. The free use would end if the project becomes a team, club or company product, or if the runtime must be self-hosted for offline or field use.
- **CheerpJ availability and calls:** The site would depend on a third-party CDN at runtime. Every call from JS into Java is async, which suits a tick-driven sim but means each hardware read or write crossing the boundary costs an `await`.

### Gaps
- No primary source gives CheerpJ's runtime download size, cold-start time or benchmark numbers. The 3.0, 4.0 and architecture pages give none.
- How CheerpJ implements threads and `Thread.sleep` (green threads vs Workers) is undocumented on the pages fetched. A search summary claimed "CheerpJ uses Web Workers for multi-threading" without a primary source, so treat it as unverified.
- Whether CheerpJ needs cross-origin isolation (COOP/COEP) on the hosting site was not verified.
- The exact TeaVM 0.13.0 release date was not found. It shipped after Java 25 GA, so late 2025 or later.

## 2. Compiling team .java source to bytecode inside the browser (javac in CheerpJ, javac/TeaVM, Janino, ECJ)

### Takeaway
Two working in-browser javac paths exist, and neither needs a server. **JavaFiddle** runs stock `com.sun.tools.javac.Main` under CheerpJ, which costs an 18.3 MB `tools.jar`. **teavm-javac** is OpenJDK javac plus TeaVM, both compiled into one WASM module (about 4.1 MB, 1.57 MB gzipped) that compiles source and then emits WASM. Janino is ruled out because it cannot compile lambdas and ignores generics.

### Cited Findings
- **JavaFiddle** (Leaning Tech, Apache-2.0) compiles by calling `cheerpjRunMain('com.sun.tools.javac.Main', '/app/tools.jar:/files/', ...'/str/'+file, '-d', '/files/', '-Xlint')`. It then runs the main class with the same classpath. Source files are injected as `/str/` string files. — [leaningtech/javafiddle `src/lib/CheerpJ.svelte`](https://github.com/leaningtech/javafiddle)
- JavaFiddle's `static/tools.jar` is **18,307,716 bytes** (measured locally from the repo clone). — [leaningtech/javafiddle](https://github.com/leaningtech/javafiddle)
- Leaning Tech: "The standard javac compiler is used, since javac is also written in Java the whole compiler runs in the browser, together with the compiled application." — [CheerpJ 2 demos page (search snippet)](https://labs.leaningtech.com/cheerpj2/demos); [JavaFiddle](https://javafiddle.leaningtech.com)
- **teavm-javac** describes itself as "An offline Java compiler that runs in the browser… two compilers in one WebAssembly module: Java compiler from OpenJDK [and] TeaVM." Last commit 2026-09-04. — [konsoletyper/teavm-javac](https://github.com/konsoletyper/teavm-javac)
- teavm-javac API: `addSourceFile`, `addJarFile(Int8Array)` for dependency jars, `setSdk(...)`, `setTeaVMClasslib(...)`, `compile()`, `onDiagnostic` with `fileName/lineNumber/columnNumber`, `getOutputJar()`, `generateWebAssembly({outputName, mainClass})`, and a ready-made Web Worker protocol (`installWorker`). — [teavm-javac README](https://github.com/konsoletyper/teavm-javac)
- Download sizes, measured locally on 2026-10-02 (raw / gzip):

  | File | Raw | gzip |
  | --- | --- | --- |
  | `compiler.wasm` (Last-Modified 2025-06-15) | 4,126,432 B | 1,568,447 B |
  | `compile-classlib-teavm.bin` (already compressed) | 199,668 B | — |
  | `runtime-classlib-teavm.bin` (already compressed) | 2,377,497 B | — |

  The total is about 6.7 MB raw and about 4.1 MB over the wire. — [teavm.org/playground/compiler.wasm](https://teavm.org/playground/compiler.wasm); [teavm-javac README](https://github.com/konsoletyper/teavm-javac)
- **VRS** (an FTC game simulator, Chief Delphi post of May 17, 2025) planned exactly this: "bundling the javac compiler (graalvm)" plus "a runtime in the browser (cheerpj)". — [Chief Delphi VRS thread](https://www.chiefdelphi.com/t/join-the-virtual-robot-simulator-vrs-development-team/501946)
- **Janino limitations:** "Lambda expressions: Partially implemented; parsed and unparsed, but not compilable", and the same for method references. "Type arguments: Are parsed, but otherwise ignored… you must cast return values from method invocations". Diamond inference and `var` are not compilable. Last commit 2024-02-15. — [Janino docs](https://janino-compiler.github.io/janino/); [janino repo](https://github.com/janino-compiler/janino)

### Inferences
- **Janino fails ordinary FTC code.** Generics are ignored, so `DcMotorEx m = hardwareMap.get(DcMotorEx.class, "lf")` would not compile without a cast. FTCLib and command-based code use lambdas heavily (`new InstantCommand(() -> claw.open())`).
- **Everything except the team's code can be built ahead of time.** Mock SDK, FTCLib, RR and Pedro jars can be compiled with a real JDK in `tools/build.mjs` and shipped as static files. Only team sources need compiling in the browser, so a static site works for path A.
- **teavm-javac is the lighter and licence-clean path A:** Apache-2.0, self-hostable, about 4 MB gzipped vs CheerpJ's runtime plus an 18 MB tools.jar.
- **TeaVM's extra step:** After javac it must AOT-compile the whole closed world (team code + SDK mocks + libraries + Kotlin stdlib for RR) to WASM on every change. Compile time for a few hundred classes in-browser is unknown.

### Gaps
- No published timing for in-browser javac (CheerpJ or teavm-javac) on a multi-file project, nor for TeaVM's WASM generation step. Benchmarking a 20-file TeamCode would be needed.
- Whether ECJ (Eclipse compiler) has been run in-browser via TeaVM or CheerpJ was not found.
- Whether TeaVM's classlib covers everything the Kotlin-based Road Runner core needs (kotlin stdlib, coroutines) was not verified.

## 3. Java source interpreters in JS: parsers and prior art, and feasibility and size of a tree-walking interpreter for the FTC Java subset

### Takeaway
A real parser is cheap. `java-parser` 3.0.1 (Chevrotain CST, Apache-2.0) bundles to 221 KB min / 65 KB gzip and parsed 1,642 lines of real team code in 41 ms warm. tree-sitter-java is about 130 KB gzip including the runtime. No maintained, embeddable, browser-only Java *interpreter* library was found. The closest prior art is Martin Pabst's Online-IDE, which is a school "Java-like" language with its own TypeScript compiler. A tree-walking interpreter for the FTC subset is a substantial but bounded build. My estimate is roughly 6–10k lines of JS (see Inferences).

### Cited Findings
- `java-parser` (npm) 3.0.1, Apache-2.0, last modified 2025-08-07, 257 KB unpacked. Its dependencies are `chevrotain` 11.0.3, `chevrotain-allstar` and `lodash`. It is part of the actively published prettier-java monorepo (last commit 2026-09-26). — [npm java-parser](https://www.npmjs.com/package/java-parser); [jhipster/prettier-java](https://github.com/jhipster/prettier-java)
- java-parser measurements (local, Node, this session):
  - The esbuild-minified ESM bundle of `parse` is **221,396 B (64,667 B gzip)**.
  - It parsed all 8 repo team files (1,642 lines, including RR `MecanumDrive.java`) with **0 errors**: **188 ms cold, 41 ms warm**.
  - It produces a concrete syntax tree, so an interpreter needs a CST→AST lowering pass.

  — [npm java-parser](https://www.npmjs.com/package/java-parser)
- tree-sitter-java 0.23.5 (last commit 2025-09-14). `tree-sitter-java.wasm` is 414,641 B (50,388 B gzip), and the `web-tree-sitter` 0.27 runtime `tree-sitter.wasm` is 205,488 B (81,305 B gzip), measured locally. It is error-tolerant and incremental, which is good for editor highlighting. — [tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java); [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter)
- **Martin Pabst Online-IDE**: "a java-like programming language with IDE for computer-science-education that runs inside any browser". The old repo says a "far better version" is in `Online-IDE-new-compiler` (old repo last commit 2025-09-14). It is a browser-only Java-subset compiler and runtime written in TypeScript with its own class library. — [martin-pabst GitHub](https://www.github.com/martin-pabst); [Online-IDE README](https://github.com/martin-pabst/Online-IDE); [Online-IDE-new-compiler](https://github.com/martin-pabst/Online-IDE-new-compiler)
- The FTC SDK runs real code via the JVM on the Robot Controller. OnBot Java is a browser IDE served by the RC that compiles on the RC, not in the browser. — [FTC docs: OnBot Java](https://ftc-docs.firstinspires.org/en/latest/programming_resources/tutorial_specific/onbot_java/creating_op_modes/Creating-and-Running-an-Op-Mode-%28OnBot-Java%29.html)

### Inferences
- **Effort estimate for path B,** extrapolated from this repo's existing JS (734-line regex parser, 497-line RR port) and from what the FTC subset needs:

  | Part | Estimated JS lines |
  | --- | --- |
  | CST→AST lowering | ~1.5k |
  | Evaluator: expressions with Java numeric semantics (int overflow, integer division, long via BigInt or clamp, char arithmetic); statements (loops, labeled break/continue, switch incl. arrow/strings/enums, try/catch/finally, throw) | ~3k |
  | Class model: fields, static init order, constructors with super(...)/this(...), virtual dispatch, overload resolution by arity then static types, inner/anonymous/local classes with outer `this`, enums with values()/ordinal/fields, interfaces with default methods, lambdas and method refs as functional-interface objects, erased generics, arrays | ~1.5–2k |
  | JDK subset: String/StringBuilder/Math/Integer/Double/Boolean/Character, ArrayList/LinkedList/HashMap/HashSet/Arrays/Collections/List.of, Optional, functional interfaces, System.nanoTime/currentTimeMillis, exceptions | ~1.5k |
  | FTC SDK mocks | ~1.5–2k |

  The total is roughly 9–10k lines, which is several weeks of focused work. That is my judgement, not a measured figure.
- **Source mapping for free.** A tree-walker can attach a source line to every node. That gives "lines that never ran" coverage, per-line error messages and stepping with almost no extra cost. JVM-in-browser paths only give stack traces with line numbers.
- **The FTC subset is narrow.** The repo's team code uses no threads, no enums and no switch, but heavy `try`, statics and many small `Action` classes. Reflection, `Thread` subclasses, annotation processing (`@Config` from FTC Dashboard) and `synchronized` are rare and can be stubbed or treated as no-ops.

### Gaps
- No usable, maintained npm "Java interpreter" library was found. Candidates such as "jsjava", "java-interpreter", JavaWiz and the CodeHS/Codio runners were not verified as browser-only or embeddable; the ones known (JavaWiz, Codio, JDoodle) appear server-backed but were not checked. A dedicated search did not happen within the tool budget.
- Whether Online-IDE-new-compiler's license and architecture would allow reuse, and how closely it matches real Java semantics, was not checked.
- No measured performance numbers exist for a JS tree-walking Java interpreter. A 20 ms tick of FTC code is typically tens to hundreds of statements, so speed is unlikely to bind, but this is an inference.

## 4. Mocking the FTC SDK and libraries: what must be stubbed, and run the team's MecanumDrive copy or a mock?

### Takeaway
VirtualRobot is a desktop simulator that runs real team OpModes on a real JVM, and its mock list is the authoritative checklist: about 75 `com.qualcomm` classes and about 40 `org.firstinspires` classes, roughly 18.4k lines of Java. It runs the **real** Road Runner 1.0 and Pedro 2.x library jars against those mocks, with the team-side quickstart files (RR `MecanumDrive.java`, Pedro `Constants.java`) kept as ordinary TeamCode. That is the faithful model. Run the team's own copy of anything in TeamCode, and replace only what lives in a library jar. Road Runner's core is **Kotlin**, so a source interpreter must port it to JS, which the repo partly has in `roadrunner.js`. FTCLib and Pedro core are **Java**, so an interpreter can run their actual source.

### Cited Findings
**What VirtualRobot mocks** (Apache-2.0, last commit 2026-09-25, needs JDK 17) — [Beta8397/virtual_robot](https://github.com/Beta8397/virtual_robot), file list read from the clone:
- `com.qualcomm.robotcore.eventloop.opmode`: `OpMode`, `LinearOpMode`, `TeleOp`, `Autonomous`, `Disabled`.
- `com.qualcomm.robotcore.hardware`:
  - Motors: `DcMotor`, `DcMotorEx`, `DcMotorSimple`, `DcMotorImpl`, `DcMotorExImpl`, `DcMotorController(Impl)`, `MotorControlAlgorithm`, `PIDCoefficients`, `PIDFCoefficients`, `MotorConfigurationType`/`MotorType`.
  - Servos: `Servo`, `ServoImpl`, `ServoController(Impl)`, `CRServo`, `CRServoImpl`.
  - Core: `HardwareMap`, `HardwareDevice`, `Gamepad`.
  - IMU and gyro: `IMU`, `ImuOrientationOnRobot`, `GyroSensor`.
  - Other sensors: `VoltageSensor(Impl)`, `TouchSensor`, `DistanceSensor`, `ColorSensor`, `NormalizedColorSensor`/`NormalizedRGBA`, `ColorRangeSensor`, `AnalogInput`, `DigitalChannel`, `LightSensor`, `OpticalDistanceSensor`.
- `com.qualcomm.hardware`: `bosch.BNO055IMU`/`BNO055IMUImpl`/`BNO055IMUNew`, `rev.RevHubOrientationOnRobot`, `rev.RevColorSensorV3`, `lynx.LynxModule`, `gobilda.GoBildaPinpointDriver`, `sparkfun.SparkFunOTOS`, `digitalchickenlabs.OctoQuad`.
- `com.qualcomm.robotcore.util`: `ElapsedTime`, `Range`, `RobotLog`, `MovingStatistics`.
- `org.firstinspires.ftc.robotcore.external`: `Telemetry` (+ `TelemetryImpl`), `Func`, and navigation (`AngleUnit`, `DistanceUnit`, `Orientation`, `AxesOrder`, `AxesReference`, `YawPitchRollAngles`, `AngularVelocity`, `Quaternion`, `Pose2D`, `CurrentUnit`, `UnnormalizedAngleUnit`).
- Also: matrices (`OpenGLMatrix`, `VectorF`), `WebcamName`/`CameraName` stubs, and the EasyOpenCV jar.

**VirtualRobot's library handling** — [Beta8397/virtual_robot](https://github.com/Beta8397/virtual_robot)
- Its README: "Now supports RoadRunner v1.0.1 AND PedroPathing v2.1.12 (including Ivy v1.0.1), with facsimiles of the quickstart teamcode provided for each".
- `lib/` ships the actual library jars: `RoadRunner.jar` (2.07 MB, 186 `com/acmerobotics/roadrunner` entries plus the bundled `kotlin/...` stdlib) and `Pedropathing.jar` (6.7 MB).
- TeamCode holds `roadrunner/MecanumDrive.java` and its localizers, and `pedroPathing/Constants.java`.

**Gamepad edge detection in VirtualRobot and the FTC SDK**
- VirtualRobot's `Gamepad` implements SDK edge detection: `aWasPressed()`/`aWasReleased()` … `dpadUpWasPressed()` etc., via `wasButtonPressed(val, bit)`. — [virtual_robot Gamepad.java](https://github.com/Beta8397/virtual_robot)
- SDK **10.3** (2025-06-25) "Added support for gamepad edge detection". SDK **11.1** (2025-12-31) made triggers readable as booleans with edge detection. The latest SDK is **12.0** (2026-09-07), whose AprilTag "Cluster" change breaks legacy AprilTag OpModes. SDK 11.2 added `@Utility` OpModes. — [FtcRobotController README](https://github.com/FIRST-Tech-Challenge/FtcRobotController)

**Library structure (what is team code vs library)**
- **Road Runner 1.0, team side:** the quickstart `MecanumDrive.java` in TeamCode does the following. — [virtual_robot TeamCode/roadrunner/MecanumDrive.java](https://github.com/Beta8397/virtual_robot)
  - It calls `hardwareMap.get(DcMotorEx.class, "front_left_motor")` and the other drive motors.
  - It sets `LynxModule.BulkCachingMode.AUTO` on every hub.
  - It builds `LazyHardwareMapImu(hardwareMap, "imu", new RevHubOrientationOnRobot(...))`.
  - It reads `voltageSensor.getVoltage()` for feedforward and defines `setDrivePowers(PoseVelocity2d)`.
  - The repo's RR folder totals 1,424 lines.
- **Road Runner core** is Kotlin (30 `.kt` files), MIT, last commit 2025-11-01. — [acmerobotics/road-runner](https://github.com/acmerobotics/road-runner)
- **Pedro Pathing 2.x, team side:** TeamCode only has `Constants.java`, with `FollowerConstants`, `MecanumConstants().leftFrontMotorName("front_left_motor")…` and `PinpointConstants().hardwareMapName("pinpoint")`. — [virtual_robot TeamCode/pedroPathing/Constants.java](https://github.com/Beta8397/virtual_robot)
  - TeleOp usage is `follower = Constants.createFollower(hardwareMap); follower.startTeleopDrive(false); follower.setTeleOpDrive(1,0,0,true); follower.update();`. — [virtual_robot pedroPathing/tuning/ForwardZeroPowerAccelerationTuner.java](https://github.com/Beta8397/virtual_robot)
  - The mecanum drivetrain class (`drivetrains/Mecanum.java`) and `Follower.java` live in the **library**. The library is **Java** (75 `.java` files), BSD-3-Clause, and actively developed (last commit 2026-10-01). — [Pedro-Pathing/PedroPathing](https://github.com/Pedro-Pathing/PedroPathing)
- **FTCLib** is Java under a BSD-style FIRST licence. Its last release is **v2.1.1 (2023-02-22)**, so it is unmaintained but still widely copied. — [FTCLib/FTCLib](https://github.com/FTCLib/FTCLib)
- NextFTC (a newer command and binding framework, with NextBindings for gamepad edge detection) appeared in 2025. — [Chief Delphi: Introducing NextFTC v1](https://www.chiefdelphi.com/t/introducing-nextftc-v1/506187)

### Inferences
- **Minimum FTC SDK mock set for the 28-team benchmark** (the VirtualRobot set trimmed):
  - Lifecycle: `OpMode` (init/init_loop/start/loop/stop) and `LinearOpMode` (`waitForStart`, `opModeIsActive`, `opModeInInit`, `isStarted`, `isStopRequested`, `sleep`, `idle`).
  - `HardwareMap`:
    - `get(Class, name)`, `get(name)`, `getAll(Class)`, `tryGet`.
    - The legacy `hardwareMap.dcMotor.get("x")` / `hardwareMap.servo.get` device mappings, and `voltageSensor.iterator()`.
  - `DcMotor`/`DcMotorEx`:
    - Direction, ZeroPowerBehavior and RunMode (RUN_TO_POSITION, RUN_USING_ENCODER, STOP_AND_RESET_ENCODER).
    - `setTargetPosition`, `getCurrentPosition`, `setVelocity`/`getVelocity`, `isBusy`, `getCurrent`.
    - `setPIDFCoefficients`, `setTargetPositionTolerance`, `setMotorEnable`/`Disable`, `getMotorType().getTicksPerRev()`.
  - `Servo` (+ `ServoImplEx.setPwmRange`) and `CRServo`.
  - IMU: `IMU` with `getRobotYawPitchRollAngles`/`getRobotAngularVelocity`/`resetYaw`, and `BNO055IMU`.
  - Sensors: `VoltageSensor`, `LynxModule` (bulk caching modes, `clearBulkCache`), `TouchSensor`, `DigitalChannel`, `DistanceSensor`, `ColorSensor`/`NormalizedColorSensor`, `AnalogInput`.
  - `Gamepad`: all fields plus the 10.3 `xWasPressed`/`xWasReleased` and the 11.1 trigger edges, `rumble`, `setLedColor`, `copy`.
  - `Telemetry`: `addData` with format args, `addLine`, `update`, `setMsTransmissionInterval`, `setAutoClear`, and the FTC Dashboard `MultipleTelemetry` wrapper.
  - Utilities: `ElapsedTime` (must run on sim time), `Range.clip`/`scale`, `AngleUnit`/`DistanceUnit`, and `GoBildaPinpointDriver`/`SparkFunOTOS`, which RR and Pedro localizers need.
- **Faithfulness rule: run what the team owns, re-implement only what a jar provides.**
  - Running the team's own `MecanumDrive.java` (RR 1.0) or `SampleMecanumDrive.java` (RR 0.5) catches their actual motor names, directions, `PARAMS`, voltage-compensated feedforward and their kinematics normalisation. A mock would silently "fix" those bugs.
  - For RR 1.0 the jar-provided layer is a JS port of the Kotlin core: `Pose2d`, `Vector2d`, `PoseVelocity2d`, `MecanumKinematics`, `MotorFeedforward`, `TrajectoryActionBuilder`, `Actions.runBlocking`, `SequentialAction`/`ParallelAction`, `TelemetryPacket`. The repo's `roadrunner.js` is a starting point.
  - For RR 0.5, the library `MecanumDrive.setDrivePower` calls the team's `setMotorPowers`.
- **Pedro 2.x:** run the library's own Java source through the interpreter (BSD-3 allows bundling), or write a JS `Follower` that reads motor names, directions and kinematics from the team's interpreted `Constants`. Running the real source is more faithful and keeps up with API churn: `setTeleOpMovementVectors` in 1.x became `setTeleOpDrive` in 2.x.
- **FTCLib:** its source is Java, so the interpreter can run the real `CommandScheduler`, `SubsystemBase`, `GamepadEx`/`ButtonReader`/`GamepadButton`, `MotorEx`, `MecanumDrive.driveRobotCentric`/`driveFieldCentric` and `PIDFController`. This fixes the 3 CommandOpMode failures with no hand-written mocks beyond the SDK.
- **Path A (bytecode) uses the libraries as-is.** Exactly as VirtualRobot does, the real RR/Pedro/FTCLib jars run unchanged and only the SDK is mocked. This is A's strongest faithfulness argument.

### Gaps
- No live FTCLib docs page or rr.brott.dev / pedropathing.com docs page was fetched (the URLs tried returned 404). The API names above come from code in VirtualRobot's TeamCode and from library repos, not from the docs sites.
- Whether SolversLib or other FTCLib forks are common in 2025-26 team code was not checked.
- Licensing for bundling FTC SDK *interfaces* reimplemented in JS was not reviewed. The SDK is BSD-licensed per its source headers, but this was not fetched.

## 5. Threading: blocking LinearOpMode code (while loops, sleep) in a browser, with deterministic 20 ms stepping

### Takeaway
The browser cannot block the main thread, so something must turn `sleep()`/`opModeIsActive()` loops into resumable code:
- **CheerpJ** handles Java threads internally (mechanism undocumented).
- **TeaVM** uses a CPS (coroutine) transform, available on JS and, since 0.13, Wasm GC.
- **A JS interpreter** can make its evaluator a generator, yielding at `sleep`, `idle`, `waitForStart`, `opModeIsActive` and loop back-edges.

Only the interpreter (and to a lesser extent TeaVM) gives exact, deterministic stepping at 20 ms sim ticks with a virtual clock.

### Cited Findings
- TeaVM: "JavaScript doesn't support threads… TeaVM comes with a solution using coroutines… TeaVM is capable of transforming methods to continuation-passing style… TeaVM threads are green threads". `synchronized`, `Object.wait` and `notify` work. — [TeaVM coroutines docs](https://www.teavm.org/docs/runtime/coroutines.html)
- TeaVM 0.13 added coroutines to Wasm GC, making `Thread.start` and `Thread.sleep` usable there. — [TeaVM 0.13.0 release notes](https://teavm.org/docs/release-notes/0.13.0.html)
- VirtualRobot's `LinearOpMode` runs `runOpMode()` on a dedicated daemon `Thread`. `idle()` is `Thread.sleep(20)`. Stop interrupts the thread and joins for 1 s, printing "Do all loops in the runOpMode method check opModeIsActive()?" if it hangs. Its timing is wall-clock, not a stepped sim clock. — [virtual_robot LinearOpMode.java](https://github.com/Beta8397/virtual_robot)
- CheerpJ "supports multiple processes and threads" and synchronization. The mechanism is not described. — [CheerpJ 3 deep dive](https://labs.leaningtech.com/blog/cheerpj-3-deep-dive)
- This repo already ticks the sim with a 20 ms Worker `setInterval`: `src/app.js` line 2595 creates a Blob Worker posting every 20 ms. — repo source

### Inferences
- **Interpreter (generator-based evaluator):**
  - The sim drives `it.next()` once per 20 ms tick. The OpMode runs until it hits a yield point:
    - `sleep(ms)`, which advances virtual time, so a single `sleep(1000)` spans 50 ticks;
    - `idle()`;
    - each `opModeIsActive()` / `isStopRequested()` call;
    - a loop back-edge after N iterations, as a guard against busy-waits.
  - `ElapsedTime`, `System.nanoTime`, `System.currentTimeMillis` and RR's own clock read the sim clock, so runs are fully deterministic and replayable.
  - Infinite loops without a check are detectable (no yield after N steps → report the line).
  - Generators cost speed, but FTC loops are tiny.
- **CheerpJ and wall-clock time:**
  - Java code sees real wall-clock time unless every time source is mocked.
  - `System.nanoTime()` is inside the JDK and is used by RR's `Actions` and by many teams' loop timers. It cannot be intercepted from a jar without bytecode rewriting.
  - Determinism and faster-than-real-time stepping are therefore hard.
  - Every hardware call crosses the async JS boundary.
- **TeaVM and time:** TeaVM's classlib is compiled in, so a custom classlib or a patched `System.nanoTime` is possible. It still runs green threads on the JS event loop, so stepping needs a custom scheduler hook.
- **Worker + SharedArrayBuffer/`Atomics.wait`:** this approach would allow truly blocking code in a Worker. It needs cross-origin isolation headers; Cloudflare Pages can set them via `_headers`, but that is unverified. Those headers can break third-party embeds such as the CheerpJ CDN or Onshape links, and it is not needed if the interpreter uses generators.

### Gaps
- No source quantifies generator overhead for a JS tree-walking interpreter, or CheerpJ thread-switch latency.
- Whether CheerpJ lets you replace `System.nanoTime`/`currentTimeMillis` (e.g. via a JNI/JS native override) was not found.

## 6. Prior art: VirtualRobot, browser FTC simulators, and others

### Takeaway
VirtualRobot is the reference for "real OpModes + mocked SDK + real RR/Pedro jars", but it is desktop JavaFX only. The browser FTC field has FTCSim (Blocks/OnBot Java, closed, implementation unknown) and VRS, which in May 2025 *planned* GraalVM javac + CheerpJ with no published result. No browser-based FTC sim was found that runs arbitrary multi-file team code with RR, Pedro and FTCLib.

### Cited Findings
- **VirtualRobot:**
  - Desktop JavaFX app needing Liberica JDK 17 full, Apache-2.0.
  - Dropdown robot config and OpMode selection, INIT/START/STOP like the Driver Station.
  - Supports `OpMode` and `LinearOpMode`, RR 1.0.1 and Pedro 2.1.12.
  - Uses dyn4j for physics and Jamepad for real gamepads.

  — [Beta8397/virtual_robot](https://github.com/Beta8397/virtual_robot)
- **FTCSim** lets you "program in FTC Blocks or On Bot Java" and "should work with any device that supports the chrome browser". Its site gives no details on how Java executes. — [ftcsim.org](https://ftcsim.org)
- The VRS lead describes FTCSim as "the >$3 million project" focused on general programming education. VRS itself is "really a FTC game simulator" with custom robot import and multiplayer, and plans "bundling the javac compiler (graalvm)" and "a runtime in the browser (cheerpj)". — [Chief Delphi VRS thread, 2025-05-17](https://www.chiefdelphi.com/t/join-the-virtual-robot-simulator-vrs-development-team/501946)
- FTC team 14140 has a physics fork of VirtualRobot (`vr_physics`). — [FTC-Team14140/vr_physics](https://github.com/FTC-Team14140/vr_physics)

### Inferences
- **VirtualRobot's mock layer is reusable for path A.** It is Apache-2.0, so its ~18k-line Java mock layer could be compiled into the SDK stub jar for A, with attribution. For path B its class list is the checklist of what to re-implement in JS.

### Gaps
- FRC WPILib browser simulation, Robot Virtual Worlds and how FTCSim runs Java were not researched within the tool budget. Nothing found shows that WPILib has a browser runtime for Java robot code.

## 7. Recommendation: (A) CheerpJ/TeaVM + javac + mocked SDK jar vs (B) Java-subset tree-walking interpreter over java-parser vs (C) source-to-source inlining into the regex interpreter

### Takeaway
**Build (B): a real Java-subset interpreter on `java-parser`, with a generator-based evaluator, a JS mock of the FTC SDK, and these libraries:**
- FTCLib and Pedro run from their own Java source.
- RR 1.0/0.5 cores are JS ports, extending `roadrunner.js`.
- Every team TeamCode file runs as written, including their copies of `MecanumDrive`/`SampleMecanumDrive`.

Keep **(A) via teavm-javac**, not CheerpJ, as a possible later "exact JVM" mode. Drop **(C)**.

### Cited Findings
These are the decision inputs, all cited in sections 1–6:

| Criterion | (A1) CheerpJ + javac | (A2) teavm-javac | (B) Interpreter on java-parser | (C) Regex inlining |
| --- | --- | --- | --- | --- |
| Faithfulness | Full JVM; real library jars. Only the SDK is mocked, as in [VirtualRobot](https://github.com/Beta8397/virtual_robot) | Full javac semantics; TeaVM classlib gaps possible | Subset semantics; library cores need porting (RR Kotlin) or interpreting (Pedro/FTCLib Java) | Poor: no loops, objects or calls across classes |
| Download | Runtime from CDN (size undocumented) plus [18.3 MB tools.jar](https://github.com/leaningtech/javafiddle) | ~4.1 MB gz ([measured](https://teavm.org/playground/compiler.wasm)) plus prebuilt jars | ~65 KB gz parser ([measured](https://www.npmjs.com/package/java-parser)) plus the interpreter | ~0 |
| Licence | Free only for individuals/FOSS via CDN; [commercial for orgs or self-hosting](https://cheerpj.com/docs/licensing) | [Apache-2.0](https://github.com/konsoletyper/teavm-javac) | Apache-2.0 parser; own code | n/a |
| Static site | Yes, but with a CDN runtime dependency | Yes, fully self-hosted | Yes | Yes |
| Determinism / 20 ms steps | Hard: wall-clock JDK time, async boundary | Possible with a custom classlib | Native (virtual clock, generators) | Native |
| "Which lines didn't run" | Stack traces only | Diagnostics with line and column for compile errors only | Per-node coverage, free | Partial |
| Compiler error messages | Real javac | Real javac ([diagnostics API](https://github.com/konsoletyper/teavm-javac)) | Interpreter must produce its own type and resolve errors | None |

### Inferences
1. **Why B wins for this product.**
   - The bench's value is explaining the robot: which line set which motor, why it didn't move, and lines that never ran, plus deterministic, repeatable, faster-than-real-time runs inside the existing 20 ms physics loop. B gives all of that natively.
   - It adds about 65 KB gz plus the interpreter, needs no third-party CDN and has no licence ceiling.
   - The 28-team failure modes (15 hardware in other classes, 5 RR/Pedro, 3 CommandOpMode or base class) are all "follow calls into objects in other files". A real class model fixes that generically.
2. **B's main risk is semantic drift** (overload resolution, int/long/char arithmetic, static init order, inner-class capture, exceptions), plus the cost of tracking library APIs.
   - Mitigate with a conformance test corpus that runs each case on a real JDK in CI (Node test + `java` locally) and diffs telemetry and motor-power traces.
   - Unsupported features should be reported as "line N: unsupported X", never silently skipped.
3. **B's library strategy, in order of faithfulness:**
   - (i) Run team-owned files as written: RR `MecanumDrive.java`, `SampleMecanumDrive.java`, Pedro `Constants.java`, subsystems, base OpModes.
   - (ii) Interpret real library Java source shipped as static assets: FTCLib (BSD-style), Pedro core (BSD-3), and for path A also VirtualRobot's SDK mocks (Apache-2.0).
   - (iii) Port Kotlin-only cores to JS: Road Runner 1.0 and 0.5.
   - (iv) Mock the SDK in JS.
4. **Suggested yield points:** `sleep`, `idle`, `waitForStart`, `opModeIsActive`/`isStopRequested`/`opModeInInit`, `Actions.runBlocking` iterations, `CommandScheduler.run`, plus a back-edge budget. All clocks read the sim's virtual time.
5. **Keep A2 (teavm-javac) as a spike, not the primary path.** It is self-hostable and Apache-2.0, and it gives real javac errors.
   - A good use is a "compile check" that tells the team their code wouldn't build: compile only, with javac against a stub SDK jar, which is cheap.
   - Before committing to it as the runtime, measure two things:
     - (a) In-browser compile plus TeaVM WASM generation time for a 20–40 file TeamCode with RR's Kotlin jar.
     - (b) Whether TeaVM's classlib covers RR/Pedro/Kotlin stdlib.
6. **Avoid CheerpJ as the runtime** unless the project stays a one-person or FOSS effort forever. The licence bars self-hosting and multi-person orgs without a commercial deal. It also has no published size or startup numbers, wall-clock time sources, and async-only interop.
7. **(C) is a dead end.** Inlining method bodies into a statement classifier cannot express object identity (two `Arm` instances), loops with state, lambdas or library calls. It would repeat today's 1-of-28 ceiling with more special cases.

### Gaps
- No head-to-head benchmark (load time, compile time, tick cost) of CheerpJ vs teavm-javac vs a JS interpreter on FTC code exists. A one-day spike measuring all three on the repo's `into-the-deep` TeamCode would settle the numbers.
- The 28-team benchmark corpus was not available to this research. The feature-usage counts here come only from the repo's 8 Java files, so a feature census of the 28 repos (lambdas, enums, switch, generics, inner classes, threads, reflection, FTC Dashboard `@Config`) should drive the interpreter's scope.
