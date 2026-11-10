# Camunda Modeler v4.7 — BPMN 2.0 Token Simulation & Validation Plugin

Lightweight extension for **Camunda Modeler v4.7** that adds **BPMN 2.0 Token Simulation** and **Schema / Soundness Validation** directly on top of the standard modeling workflow.

Modeler behavior remains unchanged during normal editing; simulation and validation run on demand via a minimal top toolbar (`▶ Token Simulation` and `✓ Validate`).

---

## Downloads (Ready-to-Run Bundles for All Platforms)

Pre-configured **Camunda Modeler v4.7.0** bundles with the plugin already installed (and telemetry/update prompts disabled) are available on the **[Releases](../../releases)** page:

| Platform / Architecture | Download Asset | How to Launch |
| :--- | :--- | :--- |
| **macOS — Apple Silicon (`M1 / M2 / M3 / M4`, `arm64`)** | `Camunda-Modeler-4.7.0-macOS-Apple-Silicon-arm64.zip` | Unzip and double-click `First-Launch-macOS.command` once (or run `xattr -cr "Camunda Modeler.app"`), then open `Camunda Modeler.app` |
| **macOS — Intel (`x86_64`)** | `Camunda-Modeler-4.7.0-macOS-Intel-x64.zip` | Unzip and double-click `First-Launch-macOS.command` once (or run `xattr -cr "Camunda Modeler.app"`), then open `Camunda Modeler.app` |
| **Windows 10 / 11 (`Intel & AMD x64`)** | `Camunda-Modeler-4.7.0-Windows-x64-Intel-AMD.zip` | Extract anywhere and run `Camunda Modeler.exe` |
| **Linux (`Intel & AMD x64`)** | `Camunda-Modeler-4.7.0-Linux-x64-Intel-AMD.tar.gz` | Extract (`tar -xzf ...`) and run `./camunda-modeler` |
| **Any OS / Browser (Zero Install, Offline)** | `BPMN-2.0-Modeler-Standalone-Offline.html` | Open directly in Chrome, Edge, Firefox, or Safari |
| **Plugin Only (Existing Camunda v4.7)** | `bpmn-token-simulation-plugin-v1.0.0.zip` | Run `install-windows.bat` or `./install-macos-linux.sh` |

---

## Features

- **Standard BPMN 2.0 Modeling Preserved:** Full access to Camunda Modeler's palette, properties, context pad, multi-tab editing, and `.bpmn` XML import/export.
- **Formal Gateway & Token Semantics:**
  - **Exclusive Gateway (`XOR`):** Interactive path selection on splits; **first-wins blocking** on `XOR` joins when concurrent parallel tokens race, while preserving single-token loop entry.
  - **Parallel Gateway (`AND`):** Concurrent token forking, full synchronisation on joins, and automatic structural deadlock detection.
  - **Inclusive Gateway (`OR`):** Multi-branch selection with `/` Default Flow rules and non-local upstream-reachability synchronisation (automatically unblocks if another branch exits early).
  - **Loops & Cycles:** Automatic topological loop detection for both structured and unstructured rework cycles.
- **Time-Aware Discrete-Event Execution:**
  - Parses activity durations automatically from attached `TextAnnotation`s (e.g., `30 minutes`, `15m`, `2 hours`) or interactive canvas badges (`0–120 min`), advancing a drift-free simulated process clock (`⏱ min`).
- **Events, Sub-Processes & Collaborations:**
  - Multi-Pool collaborations with animated cross-pool `Message Flow` envelopes.
  - `Event-Based Gateway` dynamic races between incoming messages and timers.
  - Intermediate Timer/Message Catch Events, Interrupting & Non-Interrupting Boundary Events, Terminate End Events, and hierarchical Expanded `Sub-Process` execution.
- **Schema & Soundness Validation (`✓ Validate`):**
  - Checks Start/End event completeness, Sequence Flow vs. Message Flow pool boundaries, Compensation associations, and runs a headless shadow simulation to report structural deadlocks before execution.

---

## Installing into an Existing Camunda Modeler v4.7

### Windows (Intel / AMD / ARM)
1. Download **`bpmn-token-simulation-plugin-v1.0.0.zip`** from [Releases](../../releases) (or clone this repository).
2. Double-click **`install-windows.bat`** (copies the plugin into `%APPDATA%\camunda-modeler\resources\plugins\bpmn-token-simulation`).
3. Restart Camunda Modeler v4.7.

### macOS (Apple Silicon & Intel) / Linux
```bash
git clone https://github.com/Ebuodinde/camunda-modeler-token-simulation.git
cd camunda-modeler-token-simulation
./install-macos-linux.sh
```
*(Or copy this folder manually into `~/Library/Application Support/camunda-modeler/resources/plugins/bpmn-token-simulation` on macOS or `~/.config/camunda-modeler/resources/plugins/bpmn-token-simulation` on Linux.)*

---

## License

MIT
