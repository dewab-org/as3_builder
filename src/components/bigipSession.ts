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
};

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
