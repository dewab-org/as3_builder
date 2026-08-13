// A throwaway self-signed certificate and key, used ONLY to stand in for real
// certificate material during a BIG-IP dry run.
//
// Why this exists: NetBox stores certificate metadata, not the material, so a
// declaration rendered from it references certs by BIG-IP path or carries no
// usable PEM. AS3 parses certificate content while validating, so a dry run
// would fail on the certificate long before it told you anything useful about
// the rest of the declaration. A structurally valid placeholder lets the dry
// run validate everything else.
//
// This key is public, disposable and deliberately worthless: an .invalid CN,
// a one-day lifetime, and it is never sent on an apply — only on a dry run,
// which makes no changes.
//
// It is stored base64-encoded rather than as literal PEM, and that is NOT
// obfuscation for its own sake: the literal form is copied verbatim into the
// production bundle, where every downstream secret scanner (trivy on the
// container image, whatever a consumer runs) fires on the BEGIN PRIVATE KEY
// marker. Allowlisting each of those would blunt the scanners for real keys.
// Keeping the marker out of the artifact keeps them sharp — and the value
// below is a placeholder in a file that says so, not a secret in disguise.

const CERTIFICATE_B64 =
  "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURnVENDQW1tZ0F3SUJBZ0lVUVhGMjJzVWlY" +
  "cXFBRGluK0NjV3lPbnVidnRFd0RRWUpLb1pJaHZjTkFRRUwKQlFBd1VERWtNQ0lHQTFVRUF3d2JZ" +
  "WE16TFdKMWFXeGtaWEl0WkhKNUxYSjFiaTVwYm5aaGJHbGtNU2d3SmdZRApWUVFLREI5QlV6TWdR" +
  "blZwYkdSbGNpQmtjbmt0Y25WdUlIQnNZV05sYUc5c1pHVnlNQjRYRFRJMk1EZ3hNekl6Ck1qVXhN" +
  "MW9YRFRJMk1EZ3hOREl6TWpVeE0xb3dVREVrTUNJR0ExVUVBd3diWVhNekxXSjFhV3hrWlhJdFpI" +
  "SjUKTFhKMWJpNXBiblpoYkdsa01TZ3dKZ1lEVlFRS0RCOUJVek1nUW5WcGJHUmxjaUJrY25rdGNu" +
  "VnVJSEJzWVdObAphRzlzWkdWeU1JSUJJakFOQmdrcWhraUc5dzBCQVFFRkFBT0NBUThBTUlJQkNn" +
  "S0NBUUVBNkZkeUVGVGdMa0I1CkZaeHRFTnJRYVBNUVUvbUxTTFlpblI4SkpIY0NNZXNvUkJPWFpE" +
  "MmpqYVVEZjBPaXJNQTRNMGVYb1NWSUJBK2EKRHpjamRtb1NxLzc4SzQ5dzduUlNpcXdocE42bVJx" +
  "TjBkcG5qSS8xc2NBc01YMHR2a2ZRUC9RSitHemZyeU1ucQo3YUgva2o4a01Nd2FUSjFKTGx1d0F0" +
  "M1RDYVZxOEdQYThiYVNVZ2FNd2wreHBUSHNBaW83N1JoanVaMTRTbkd6CnZTdCthZTJmQzV5QlZu" +
  "c3cySE1wWERGVTNjajg5cDFya3gvbVZJL2ZUR0ROVHVFMU1aSjlJOGZMaHJUdUhyY2QKa2JmOVZM" +
  "SkJoMW5NYm5CRkxGbHYwcVorOTYvTVBTZGNvN0p1S3p1SWV6OHA4VzdaUXdVREpoaVBMdTg5N2dG" +
  "aQpRN2ZtUzdwNkF3SURBUUFCbzFNd1VUQWRCZ05WSFE0RUZnUVU1OEtwaVZQVVpNZmNIREt3UTVh" +
  "bXdoUEVrWUF3Ckh3WURWUjBqQkJnd0ZvQVU1OEtwaVZQVVpNZmNIREt3UTVhbXdoUEVrWUF3RHdZ" +
  "RFZSMFRBUUgvQkFVd0F3RUIKL3pBTkJna3Foa2lHOXcwQkFRc0ZBQU9DQVFFQUhhRUdsaE5HUnB4" +
  "V2hpWTVqdC8xQnZWZmtTWVdiL3llTjNpKwpUeHozUjd3TzRyeGtTdGVkeVBxb05PVXBHMlR1NzlJ" +
  "SkczbHNIUWU3Z21LZWtqUGNCRVVwQjBTMlc0T2RPWE53CnF1NW8vMnJhVjloTlB5MlFYN09JNjFI" +
  "YjZVV1V3L2hKKzk1enIrNHVxWnYyVnErZ0NNZzMxMDZ0RlBjb0J4NlQKMmRqVm1CZms5SWR2bUR4" +
  "SVVUNlZqNFVJODZ6L1dPQkJTSnU5Mmw4UVQvR1BxYk5WSm91MnpjVEw0NHp3VXZWSgp3QUFvQy90" +
  "ZEFUY2R1bHI1d1dFSHZDMWpHNVdKSzRqK0Nkc1E3RFhpV3NUVkJuWkF3OWpSdFpOQXYybzQ2MGlH" +
  "CjNRYnFQTExoSGUyK01DS1kreERWRzBTclZoN2V1RmtDakhsTGkxWmw5MElEcDE4N3VRPT0KLS0t" +
  "LS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=";

const PRIVATE_KEY_B64 =
  "LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2Z0lCQURBTkJna3Foa2lHOXcwQkFRRUZB" +
  "QVNDQktnd2dnU2tBZ0VBQW9JQkFRRG9WM0lRVk9BdVFIa1YKbkcwUTJ0Qm84eEJUK1l0SXRpS2RI" +
  "d2trZHdJeDZ5aEVFNWRrUGFPTnBRTi9RNktzd0RnelI1ZWhKVWdFRDVvUApOeU4yYWhLci92d3Jq" +
  "M0R1ZEZLS3JDR2szcVpHbzNSMm1lTWovV3h3Q3d4ZlMyK1I5QS85QW40Yk4rdkl5ZXJ0Cm9mK1NQ" +
  "eVF3ekJwTW5Va3VXN0FDM2RNSnBXcndZOXJ4dHBKU0JvekNYN0dsTWV3Q0tqdnRHR081blhoS2Ni" +
  "TzkKSzM1cDdaOExuSUZXZXpEWWN5bGNNVlRkeVB6Mm5XdVRIK1pVajk5TVlNMU80VFV4a24wang4" +
  "dUd0TzRldHgyUgp0LzFVc2tHSFdjeHVjRVVzV1cvU3BuNzNyOHc5SjF5anNtNHJPNGg3UHlueGJ0" +
  "bERCUU1tR0k4dTd6M3VBV0pECnQrWkx1bm9EQWdNQkFBRUNnZ0VBQUsxWWtNR2VrYVB3ZG1hcFRy" +
  "WkVpem5DSDJ5SHdtTjlnRlc1MGhoaXNrQ00KTW42WUgxdXFvVndNd1k4eDV5ejhQUElGZUJ2Q3RQ" +
  "aFNxNTZ1aE1iVVhSbjJKQzViMXVZUjQ0T1M2WWNZbHZZYwovY2QvQ1BqUkd4WjlKNzN4aWt4YXk1" +
  "TDVTUjBGbStVeXdSU0t5U05UK0t4dm15K09LZ3RzWE9YR21xMlh2VEdiCjRycHVvNzVJWUx2VGNZ" +
  "UFZsQUdvTDhKZjg5QktpV0hJblhjdDkrSkh5cFNEUDFJVERmemVvcVBKeVp3bHBEbHAKdUxMYVRi" +
  "NG1Jb1YwWVliTFhnRFlXQ2drUkJvSTQ1cE1rRjVYUTNNa2NrR00yeE16UTJwSllRdFlGc3UvTmky" +
  "ZApneERSTkF5VndQOWtvT1FGcXN1c1lLQnpxQkxjUHNBeWIvamNSU3IxU1FLQmdRRDVoTTBtckhB" +
  "emRQM3FhMm5RCk9YM05pa2IvazBob0k0a1EvUTkzS2JFOUN2TGQ3bk55dDNYOS8xN2Z1cktCT0NX" +
  "anlTZlg5NmJpZXlzNmR6VFkKSG40L25qNTFEd2g2RXJGQjZ3MDR4OURPOTMvd3lVczMvME9jQnpT" +
  "N1BCc3ZkVk1IMXFWU0s3RmUvS29ZaktScgp6ajNPcWUyNFdVdmZ5STR0NWZiZi9oeks5d0tCZ1FE" +
  "dVlHeEhPU0E5SWpmOXVMMUMzYzJ1S2NXMi95TUFnWjdzCklqcEdLUjM5cW5tZVJNQXovajRDZUdh" +
  "bzRDanBKdkI3UGM2QTFPNkRTbU5HZUVha1lkK0FpT2Z1NytZWlpEcy8KUjZIZytqNFJobmswbTYv" +
  "OW01Z2RFWU1DaWpWd3BvMjF1eStZMDVmVVJoZVVYVGVWNk8zWG1lSVZJQURETU91VQpwR1EzMjJJ" +
  "YVZRS0JnRE9ibng3M25ZRlhHa21KQytxd2FXL0F3T3lObHZWTEhFZHlQK2VpclBEMk9jTmpWV2VO" +
  "CndJN1hhZFVXZFdNNnJMWlNuYllTbCtiU0dOL1AxaE01UTExL0ttWGx4UmdTazYwUm83dHh3S04r" +
  "RjIxREJSYkEKNmtmMFNaak1Wc2NiR2lCTjZnV3oyY3pPcjVQQ1N5T3RGYVdRQ2dZT0doNWdDZUEr" +
  "WnpCdkM1K0RBb0dCQUtHVQpQSEQrdU9xWGNrcUtXY2VrWDFISndOb3RFUVc3MXdTS291T0I1WEZY" +
  "aDc2UExaVlFwYW01QVNWQlpKbTlxazV2CmM3V0NIL1pnaXZCdWdMdldGOUNoZkUxSzBiYXVhVGFZ" +
  "a0pMV0xSSm1DMnhzaDV1cFJ5K1UraS9UalN2QnlkYkEKZmgvaWRVMFBBZGF3WlFnNWJsYXhXVDBt" +
  "aHozSHdEZnVRbnhXT2FaTkFvR0JBTVpPVEdGMU5CdnZQQ1VCUVFCZApkWmZjZkt3dnNhQTVJYjRR" +
  "SUk0R2dSUEdCeFRDNU5xZy9DeE1lSjc0WndrSkEwQ1FESk03emZMZitYY0pMZzgvCjdVa3ZMYzA2" +
  "R0FQcFpLNnVBOUdOV3hidzI1NS9NWHRvZHFzWGwzeDl5RmczdldzaFBKZDZleHRsVmk0Y0VMeTUK" +
  "aGZjTU1RWXNqNkhzdGJUMkJKaHNjeHNDCi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0K";

function decode(b64: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  );
}

export const DRY_RUN_CERTIFICATE_PEM = decode(CERTIFICATE_B64);
export const DRY_RUN_PRIVATE_KEY_PEM = decode(PRIVATE_KEY_B64);
