# AI agent tools: CLI-Anything and REA for FTC SimBench Pro

Research note, 2026-11-17. It covers two agent toolkits:

- **[CLI-Anything](https://github.com/HKUDS/CLI-Anything)** (Apache-2.0) wraps real desktop programs (FreeCAD, Blender, 3MF and others) in CLIs that agents can drive.
- **[REA](https://github.com/morluto/rea)** (MIT) is an MCP server and CLI that gives agents reverse-engineering tools.

This file covers only what matters for **this** repo.

How to read the labels:

- **Confirmed**: checked against the tool's own repo or docs.
- **Recommendation**: a suggestion, not tested.
- Nothing below was run end to end on this project yet.

## What could help here

| Tool | Use in this repo | Value |
|---|---|---|
| CLI-Anything **FreeCAD** harness | A ground-truth check for the OpenCascade pipeline: per-shape volume, mass, CoM and inertia (`inertia`, `center-of-mass`), `check-geometry` on troublesome STEP files, and `dof` on assemblies. The **recommendation**: make it a test oracle for the "any robot" corpus and joint finder (for example, rollers and slides falsely detected) | High |
| REA **JS analysis** | Audit the Cloudflare Pages build: which vendor bundles ship, and whether source maps leak. The license is proprietary, so check what the public build exposes | Medium |
| REA **ADB tools** | Compare real Control Hub runs (logcat) with SimBench runs of the same OpModes, to check how realistic the sim is | Medium |
| REA **`environment-build`** | Portfolio: build agent environments from the driver-practice / path-editor UIs | Low-Medium |

## Proposed changes (not made yet)

1. Add a `tools/` script that takes a corpus STEP, asks FreeCAD for per-part inertia, and diffs it against `src/` physics inputs. Add it to the test suite only when FreeCAD is installed, and report it as skipped otherwise. A silent pass would hide a missing check.
2. Record the result in `ftc-platform` (MASTER_PROGRESS.md) per the platform rules.

## Status on the dev PC (updated 2026-11-17)

- **Installed and working:**
  - Agent skills `cli-hub-meta-skill` and `reverse-engineer-anything`.
  - `cli-anything-hub` 0.4.1.
  - Node 24.22.1.
  - REA 6.9.0 (global `rea`), registered as an MCP server in Claude Code. `rea doctor` reports it healthy.
  - FreeCAD 1.1.4, with the `cli-anything-freecad` harness (`FREECAD_PATH` points at `FreeCADCmd.exe`).
- **Smoke-tested:**
  - REA's JS analysis of the shot-sim build.
  - A FreeCAD cube built and measured (volume and center of mass correct), then exported to STEP through headless FreeCAD.
- **Not installed:** REA's optional engines (Ghidra, IDA, JADX/JDK 17+, Kuna), adb, and Blender.

## Rules for REA

Use REA only on code and builds we made, or on devices we own. Reverse engineering commercial software can break its EULA or DMCA §1201, and §1201(f) covers only narrow interoperability work. REA's tool results are sent to the AI model provider, so never point it at keys, `.env` files or credentials.
