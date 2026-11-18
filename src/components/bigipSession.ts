// BIG-IP connection details for the dialog. In memory only — they survive
// closing and reopening it, and are cleared on refresh, never persisted.
//
// Kept out of the dialog so that file exports only components (see chips.ts).

export const remembered = {
  host: "",
  username: "",
  password: "",
  tenant: "Applications",
  validateCert: true,
  /** True once "Connect to BIG-IP…" has verified the device this session. */
  connected: false,
  /** AS3 version reported by the device at connect time. */
  as3Version: "",
};

/** Request headers for the dev/production server's BIG-IP proxy. */
export function bigipAuthHeaders(): Record<string, string> {
  return {
    authorization: `Basic ${btoa(`${remembered.username}:${remembered.password}`)}`,
    "x-bigip-target": remembered.host.trim(),
    "x-bigip-validate-cert": remembered.validateCert ? "1" : "0",
    "content-type": "application/json",
  };
}

/** Seed the fields from the server's environment, without overwriting
 * anything the user has already typed this session. */
export function applyBigipDefaults(defaults: {
  host: string;
  username: string;
  password: string;
  validateCert: boolean;
}): void {
  remembered.host ||= defaults.host;
  remembered.username ||= defaults.username;
  remembered.password ||= defaults.password;
  remembered.validateCert = defaults.validateCert;
}
