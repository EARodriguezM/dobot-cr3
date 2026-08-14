#!/usr/bin/env node
// Copy the CR3 description (URDF + visual meshes) out of the ROS 2 submodule
// into public/robot/, where the browser 3D view loads it statically.
//
// Why a build step instead of committed assets: the meshes are ~37 MB of
// Collada XML that belong to the ROS package (`dobot_cr3_description`), not to
// this repo — vendoring them would duplicate the submodule and bloat every
// clone. They are regenerated from the submodule on every build instead.
//
// Degrades on purpose: with the submodule uninitialised this prints a warning
// and exits 0, so the app still builds and boots — the 3D tab simply reports
// the model as unavailable (PLATFORM-GUIDE §2: everything degrades, never
// crashes). Run `git submodule update --init` to enable it.

import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const description = join(
  root,
  "ros2_interfaces/dobot_cr3_control/src/dobot_cr3_description",
);
const urdfSource = join(
  root,
  "ros2_interfaces/dobot_cr3_control/src/dobot_cr3_moveit_config/config/dobot_cr3.urdf",
);
const outDir = join(root, "public/robot");

// The URDF addresses meshes through the ROS package resolver; the browser
// needs plain URLs under the public/ mount.
//
// The replacement is empty on purpose, leaving paths relative to the URDF
// ("meshes/visual/base_link.dae"): urdf-loader resolves every mesh against the
// directory the URDF was fetched from, so an absolute "/robot/..." here would
// be prefixed a second time and requested as "/robot/robot/meshes/...".
const PACKAGE_URI = "package://dobot_cr3_description/";
const PUBLIC_BASE = "";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(urdfSource)) || !(await exists(description))) {
    console.warn(
      "[robot-assets] ROS 2 submodule not initialised — skipping.\n" +
        "              The 3D view will report the model as unavailable.\n" +
        "              Fix with: git submodule update --init",
    );
    return;
  }

  await mkdir(outDir, { recursive: true });

  // Only visual meshes: urdf-loader ignores <collision> unless asked, and the
  // collision STLs would add ~8 MB the browser never renders.
  await cp(join(description, "meshes/visual"), join(outDir, "meshes/visual"), {
    recursive: true,
  });

  const urdf = await readFile(urdfSource, "utf8");
  await writeFile(
    join(outDir, "dobot_cr3.urdf"),
    urdf.replaceAll(PACKAGE_URI, PUBLIC_BASE),
    "utf8",
  );

  console.log(`[robot-assets] wrote ${outDir}`);
}

await main();
