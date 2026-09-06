import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const python =
  process.platform === "win32"
    ? "scripts/property-sync/.venv/Scripts/python.exe"
    : "scripts/property-sync/.venv/bin/python";
if (!existsSync(python)) {
  process.stderr.write("Create scripts/property-sync/.venv and install requirements.txt first.\n");
  process.exitCode = 1;
} else {
  const result = spawnSync(python, ["-m", "pytest", "scripts/property-sync/tests", "-q"], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}
