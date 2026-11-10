# Camunda Modeler v4.7 — BPMN 2.0 Token Simulation & Validation Plugin

Lightweight extension for **Camunda Modeler v4.7** that adds **BPMN 2.0 Token Simulation** and **Schema / Soundness Validation** directly on top of the standard modeling workflow.

 Modeler behavior remains unchanged during normal editing; simulation and validation run on demand via a minimal top toolbar (`▶ Token Simulation` and `✓ Validate`).

---

## Features

- **Standard BPMN 2.0 Modeling Preserved:** Full access to Camunda Modeler's palette, properties, context pad, and `.bpmn` XML import/export.
- **Formal Gateway & Token Semantics:**
  - **Exclusive Gateway (`XOR`):** Interactive path selection on splits; **first-wins blocking** on `XOR` joins when concurrent parallel tokens race, while preserving single-token loop entry.
  - **Parallel Gateway (`AND`):** Concurrent token forking, full synchronisation on joins, and automatic structural deadlock detection.
  - **Inclusive Gateway (`OR`):** Multi-branch selection with `/` Default Flow rules and non-local upstream-reachability synchronisation (automatically unblocks if another branch exits early).
  - **Loops & Cycles:** Automatic topological loop detection for both structured and unstructured rework cycles.
- **Time-Aware Discrete-Event Execution:**
  - Parses activity durations automatically from attached `TextAnnotation`s (e.g., `30 minutes`, `15m`, `2 hours`) or interactive canvas badges, advancing a Drift-Free simulated process clock (`⏱ min`).
- **Events, Sub-Processes & Collaborations:**
  - Multi-Pool collaborations with animated cross-pool `Message Flow` envelopes.
  - `Event-Based Gateway` dynamic races between incoming messages and timers.
  - Intermediate Timer/Message Catch Events, Interrupting & Non-Interrupting Boundary Events, Terminate End Events, and hierarchical Expanded `Sub-Process` execution.
- **Schema & Soundness Validation (`✓ Validate`):**
  - Checks Start/End event completeness, Sequence Flow vs. Message Flow pool boundaries, Compensation associations, and runs a headless shadow simulation to report structural deadlocks before execution.

---

## Installation

### Option A — Ready-to-Run Windows Bundle (No Setup Required)
Download **`Camunda-Modeler-4.7.0-Windows-x64-Token-Simulation.zip`** from the [Releases](../../releases) page, extract it anywhere, and launch `Camunda Modeler.exe`.

### Option B — Install into an Existing Camunda Modeler v4.7

#### Windows
1. Download **`bpmn-token-simulation-plugin-v1.0.0.zip`** from [Releases](../../releases) (or clone this repository).
2. Double-click **`install-windows.bat`** (copies the plugin into `%APPDATA%\camunda-modeler\resources\plugins\bpmn-token-simulation`).
3. Restart Camunda Modeler v4.7.

#### macOS / Linux
```bash
git clone https://github.com/Ebuodinde/camunda-modeler-token-simulation.git
cd camunda-modeler-token-simulation
./install-macos-linux.sh
```
*(Or copy this folder manually into `~/Library/Application Support/camunda-modeler/resources/plugins/bpmn-token-simulation` on macOS or `~/.config/camunda-modeler/resources/plugins/bpmn-token-simulation` on Linux.)*

---

## Usage

1. Model any BPMN 2.0 process or open an existing `.bpmn` file in Camunda Modeler v4.7.
2. *(Optional)* Attach a `TextAnnotation` such as `20 minutes` or `45m` to tasks or timer events to specify custom durations.
3. Click **`✓ Validate`** in the top bar to check BPMN 2.0 pool/message rules and structural soundness.
4. Click **`▶ Token Simulation`** -> **`▶ Run`** (or use **`⏭ Step (+5m)`**, **`⏸ Pause`**, **`↺ Reset`**, and the speed selector) to inspect live token behaviour.

---

## License

MIT
