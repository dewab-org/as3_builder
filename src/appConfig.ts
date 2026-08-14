// Startup defaults served by the dev/production server from its environment
// (.env, real env vars, or --flags). Fetched once at boot; the values only
// prefill the dialogs, and nothing is persisted.

export interface AppConfig {
  bigip: {
    host: string;
    username: string;
    password: string;
    validateCert: boolean;
  };
  netbox: {
    url: string;
    token: string;
    username: string;
    password: string;
    validateCert: boolean;
  };
  includesCredentials: boolean;
  warnings: string[];
}

export const EMPTY_APP_CONFIG: AppConfig = {
  bigip: { host: "", username: "", password: "", validateCert: true },
  netbox: {
    url: "",
    token: "",
    username: "",
    password: "",
    validateCert: true,
  },
  includesCredentials: false,
  warnings: [],
};

let configPromise: Promise<AppConfig> | undefined;

/** Never rejects: without a server-side config the dialogs simply start blank. */
export function loadAppConfig(): Promise<AppConfig> {
  configPromise ??= fetch("/app-config")
    .then((res) => (res.ok ? res.json() : EMPTY_APP_CONFIG))
    .then((value: AppConfig) => ({ ...EMPTY_APP_CONFIG, ...value }))
    .catch(() => EMPTY_APP_CONFIG);
  return configPromise;
}
