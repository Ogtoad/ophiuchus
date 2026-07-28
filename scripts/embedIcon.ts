// postBuild + postPackage hook: stamps icon.ico into the built Windows exes.
// Electrobun's own icon embedding is broken — its CLI ships as a compiled
// binary with the CI machine's rcedit path baked into require.resolve, so it
// warns and skips. postBuild runs before the bundle is hashed and compressed,
// so dev runs, the packed archive, and the installed app all carry the icon.
// postPackage (same script; the Setup exe only exists by then) stamps the
// installer itself and refreshes its entry in the artifact zip.
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

if (process.env.ELECTROBUN_OS !== "win") process.exit(0);

const buildDir = process.env.ELECTROBUN_BUILD_DIR!;
const icon = join(import.meta.dir, "..", "icon.ico");
const rcedit = join(import.meta.dir, "..", "node_modules", "rcedit", "bin", "rcedit-x64.exe");
if (!existsSync(icon)) { console.log("embedIcon: no icon.ico — skipped"); process.exit(0); }
if (!existsSync(rcedit)) { console.log("embedIcon: rcedit not installed — skipped"); process.exit(0); }

// build/<env>-win-x64/<app>/bin/{launcher,bun}.exe
const glob = new Bun.Glob("**/bin/{launcher,bun}.exe");
let n = 0;
const t0 = Date.now();
for (const rel of glob.scanSync({ cwd: buildDir })) {
  const exe = join(buildDir, rel);
  if (!statSync(exe).isFile()) continue;
  const t = Date.now();
  execFileSync(rcedit, [exe, "--set-icon", icon]);
  console.log(`embedIcon: stamped ${rel} (${Date.now() - t}ms, glob+startup ${t - t0}ms)`);
  n += 1;
}
if (!n) console.log("embedIcon: no launcher/bun exes found under " + buildDir);

// Setup exe (exists only in the postPackage run of release builds): stamp it,
// refresh its entry in the artifact zip, and — the actual distributable —
// build a SINGLE-FILE installer. The extractor supports an embedded payload
// (extractor + ELECTROBUN_METADATA_V1 + metadata + ELECTROBUN_ARCHIVE_V1 +
// archive is exactly what electrobun ships on Linux); its Windows CLI just
// never concatenates, leaving a stub that dies without its sidecar files.
// Stamp the icon BEFORE appending — rcedit rewrites the exe's resource
// sections and would corrupt an already-appended overlay.
const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR || "";
for (const rel of new Bun.Glob("*-Setup.exe").scanSync({ cwd: buildDir })) {
  const exe = join(buildDir, rel);
  execFileSync(rcedit, [exe, "--set-icon", icon]);
  console.log("embedIcon: stamped " + rel);
  if (!artifactDir || !existsSync(artifactDir)) continue;
  for (const zip of new Bun.Glob("*-Setup.zip").scanSync({ cwd: artifactDir })) {
    execFileSync("powershell", ["-NoProfile", "-Command",
      `Compress-Archive -Path '${exe}' -DestinationPath '${join(artifactDir, zip)}' -Update`]);
    console.log("embedIcon: refreshed " + zip);
  }
  const meta = exe.replace(/\.exe$/, ".metadata.json");
  const tar = exe.replace(/\.exe$/, ".tar.zst");
  if (existsSync(meta) && existsSync(tar)) {
    const single = join(artifactDir, basename(exe));
    writeFileSync(single, Buffer.concat([
      readFileSync(exe),
      Buffer.from("ELECTROBUN_METADATA_V1"), readFileSync(meta),
      Buffer.from("ELECTROBUN_ARCHIVE_V1"), readFileSync(tar),
    ]));
    console.log(`embedIcon: single-file installer ${basename(single)} (${(statSync(single).size / 1024 / 1024).toFixed(1)} MB)`);
  }
}
