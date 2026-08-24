// The single source of truth for the app's identity, shown in the About
// dialog.
//
// The display version uses the project's own two-part scheme (0.05, 0.06, …).
// package.json cannot hold it — semver forbids leading zeros — so it carries
// the mapped form (0.05 → 0.5.0), and a test keeps the two in lockstep.
export const APP_VERSION = "0.06";
export const APP_AUTHOR = "Daniel Whicker";
export const APP_REPO = "https://github.com/dewab-org/as3_builder";

/** Display form of the semver mirror: 0.5.0 → "0.05", 0.5.1 → "0.05.1". */
export function displayFromSemver(semver: string): string {
  const [, minor = "0", patch = "0"] = semver.split(".");
  const base = `0.${String(Number(minor)).padStart(2, "0")}`;
  return Number(patch) > 0 ? `${base}.${Number(patch)}` : base;
}
