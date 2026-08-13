// A throwaway self-signed certificate and key, used ONLY to stand in for real
// certificate material during a BIG-IP dry run.
//
// Why this exists: NetBox stores certificate metadata, not the material, so a
// declaration rendered from it references certs by BIG-IP path or carries no
// usable PEM. AS3 parses certificate content while validating, so a dry run
// would fail on the certificate long before it told you anything useful about
// the rest of the declaration. Substituting a structurally valid placeholder
// lets the dry run validate everything else.
//
// This key is public, disposable and deliberately worthless: CN is an
// .invalid hostname, the certificate is expired, and it is never sent on an
// apply — only on a dry run, which makes no changes.

// gitleaks:allow
export const DRY_RUN_CERTIFICATE_PEM =
  "-----BEGIN CERTIFICATE-----\n" +
  "MIIDgTCCAmmgAwIBAgIUQXF22sUiXqqADin+CcWyOnubvtEwDQYJKoZIhvcNAQEL\n" +
  "BQAwUDEkMCIGA1UEAwwbYXMzLWJ1aWxkZXItZHJ5LXJ1bi5pbnZhbGlkMSgwJgYD\n" +
  "VQQKDB9BUzMgQnVpbGRlciBkcnktcnVuIHBsYWNlaG9sZGVyMB4XDTI2MDgxMzIz\n" +
  "MjUxM1oXDTI2MDgxNDIzMjUxM1owUDEkMCIGA1UEAwwbYXMzLWJ1aWxkZXItZHJ5\n" +
  "LXJ1bi5pbnZhbGlkMSgwJgYDVQQKDB9BUzMgQnVpbGRlciBkcnktcnVuIHBsYWNl\n" +
  "aG9sZGVyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6FdyEFTgLkB5\n" +
  "FZxtENrQaPMQU/mLSLYinR8JJHcCMesoRBOXZD2jjaUDf0OirMA4M0eXoSVIBA+a\n" +
  "DzcjdmoSq/78K49w7nRSiqwhpN6mRqN0dpnjI/1scAsMX0tvkfQP/QJ+GzfryMnq\n" +
  "7aH/kj8kMMwaTJ1JLluwAt3TCaVq8GPa8baSUgaMwl+xpTHsAio77RhjuZ14SnGz\n" +
  "vSt+ae2fC5yBVnsw2HMpXDFU3cj89p1rkx/mVI/fTGDNTuE1MZJ9I8fLhrTuHrcd\n" +
  "kbf9VLJBh1nMbnBFLFlv0qZ+96/MPSdco7JuKzuIez8p8W7ZQwUDJhiPLu897gFi\n" +
  "Q7fmS7p6AwIDAQABo1MwUTAdBgNVHQ4EFgQU58KpiVPUZMfcHDKwQ5amwhPEkYAw\n" +
  "HwYDVR0jBBgwFoAU58KpiVPUZMfcHDKwQ5amwhPEkYAwDwYDVR0TAQH/BAUwAwEB\n" +
  "/zANBgkqhkiG9w0BAQsFAAOCAQEAHaEGlhNGRpxWhiY5jt/1BvVfkSYWb/yeN3i+\n" +
  "Txz3R7wO4rxkStedyPqoNOUpG2Tu79IJG3lsHQe7gmKekjPcBEUpB0S2W4OdOXNw\n" +
  "qu5o/2raV9hNPy2QX7OI61Hb6UWUw/hJ+95zr+4uqZv2Vq+gCMg3106tFPcoBx6T\n" +
  "2djVmBfk9IdvmDxIUT6Vj4UI86z/WOBBSJu92l8QT/GPqbNVJou2zcTL44zwUvVJ\n" +
  "wAAoC/tdATcdulr5wWEHvC1jG5WJK4j+CdsQ7DXiWsTVBnZAw9jRtZNAv2o460iG\n" +
  "3QbqPLLhHe2+MCKY+xDVG0SrVh7euFkCjHlLi1Zl90IDp187uQ==\n" +
  "-----END CERTIFICATE-----\n";

// gitleaks:allow
export const DRY_RUN_PRIVATE_KEY_PEM =
  "-----BEGIN PRIVATE KEY-----\n" +
  "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDoV3IQVOAuQHkV\n" +
  "nG0Q2tBo8xBT+YtItiKdHwkkdwIx6yhEE5dkPaONpQN/Q6KswDgzR5ehJUgED5oP\n" +
  "NyN2ahKr/vwrj3DudFKKrCGk3qZGo3R2meMj/WxwCwxfS2+R9A/9An4bN+vIyert\n" +
  "of+SPyQwzBpMnUkuW7AC3dMJpWrwY9rxtpJSBozCX7GlMewCKjvtGGO5nXhKcbO9\n" +
  "K35p7Z8LnIFWezDYcylcMVTdyPz2nWuTH+ZUj99MYM1O4TUxkn0jx8uGtO4etx2R\n" +
  "t/1UskGHWcxucEUsWW/Spn73r8w9J1yjsm4rO4h7PynxbtlDBQMmGI8u7z3uAWJD\n" +
  "t+ZLunoDAgMBAAECggEAAK1YkMGekaPwdmapTrZEiznCH2yHwmN9gFW50hhiskCM\n" +
  "Mn6YH1uqoVwMwY8x5yz8PPIFeBvCtPhSq56uhMbUXRn2JC5b1uYR44OS6YcYlvYc\n" +
  "/cd/CPjRGxZ9J73xikxay5L5SR0Fm+UywRSKySNT+Kxvmy+OKgtsXOXGmq2XvTGb\n" +
  "4rpuo75IYLvTcYPVlAGoL8Jf89BKiWHInXct9+JHypSDP1ITDfzeoqPJyZwlpDlp\n" +
  "uLLaTb4mIoV0YYbLXgDYWCgkRBoI45pMkF5XQ3MkckGM2xMzQ2pJYQtYFsu/Ni2d\n" +
  "gxDRNAyVwP9koOQFqsusYKBzqBLcPsAyb/jcRSr1SQKBgQD5hM0mrHAzdP3qa2nQ\n" +
  "OX3Nikb/k0hoI4kQ/Q93KbE9CvLd7nNyt3X9/17furKBOCWjySfX96bieys6dzTY\n" +
  "Hn4/nj51Dwh6ErFB6w04x9DO93/wyUs3/0OcBzS7PBsvdVMH1qVSK7Fe/KoYjKRr\n" +
  "zj3Oqe24WUvfyI4t5fbf/hzK9wKBgQDuYGxHOSA9Ijf9uL1C3c2uKcW2/yMAgZ7s\n" +
  "IjpGKR39qnmeRMAz/j4CeGao4CjpJvB7Pc6A1O6DSmNGeEakYd+AiOfu7+YZZDs/\n" +
  "R6Hg+j4Rhnk0m6/9m5gdEYMCijVwpo21uy+Y05fURheUXTeV6O3XmeIVIADDMOuU\n" +
  "pGQ322IaVQKBgDObnx73nYFXGkmJC+qwaW/AwOyNlvVLHEdyP+eirPD2OcNjVWeN\n" +
  "wI7XadUWdWM6rLZSnbYSl+bSGN/P1hM5Q11/KmXlxRgSk60Ro7txwKN+F21DBRbA\n" +
  "6kf0SZjMVscbGiBN6gWz2czOr5PCSyOtFaWQCgYOGh5gCeA+ZzBvC5+DAoGBAKGU\n" +
  "PHD+uOqXckqKWcekX1HJwNotEQW71wSKouOB5XFXh76PLZVQpam5ASVBZJm9qk5v\n" +
  "c7WCH/ZgivBugLvWF9ChfE1K0bauaTaYkJLWLRJmC2xsh5upRy+U+i/TjSvBydbA\n" +
  "fh/idU0PAdawZQg5blaxWT0mhz3HwDfuQnxWOaZNAoGBAMZOTGF1NBvvPCUBQQBd\n" +
  "dZfcfKwvsaA5Ib4QII4GgRPGBxTC5Nqg/CxMeJ74ZwkJA0CQDJM7zfLf+XcJLg8/\n" +
  "7UkvLc06GAPpZK6uA9GNWxbw255/MXtodqsXl3x9yFg3vWshPJd6extlVi4cELy5\n" +
  "hfcMMQYsj6HstbT2BJhscxsC\n" +
  "-----END PRIVATE KEY-----\n";
