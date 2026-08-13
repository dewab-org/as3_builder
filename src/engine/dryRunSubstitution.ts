import { isPlainObject } from "./types";
import {
  DRY_RUN_CERTIFICATE_PEM,
  DRY_RUN_PRIVATE_KEY_PEM,
} from "./dryRunCertificate";

type Dict = Record<string, unknown>;

export interface DryRunSubstitution {
  /** A copy of the declaration, safe to submit as a dry run. */
  declaration: Dict;
  /** AS3 keys whose certificate material was replaced. */
  substituted: string[];
}

/**
 * Replace certificate material with a disposable placeholder for a dry run.
 *
 * Declarations rendered from NetBox reference certificates that live in the
 * certificate estate, not in the declaration — usually as a BIG-IP path that
 * may not exist on the box being validated. AS3 checks certificates while
 * validating, so the run fails on the certificate and tells you nothing about
 * the rest of the declaration. Swapping in a structurally valid throwaway pair
 * lets everything else be validated.
 *
 * Dry run only. An apply must carry the real material, and never calls this.
 */
export function substituteDryRunCertificates(
  declaration: Dict
): DryRunSubstitution {
  const copy = JSON.parse(JSON.stringify(declaration)) as Dict;
  const substituted: string[] = [];

  const walk = (node: unknown, key: string) => {
    if (!isPlainObject(node)) return;
    if (node.class === "Certificate") {
      node.certificate = { text: DRY_RUN_CERTIFICATE_PEM };
      node.privateKey = { text: DRY_RUN_PRIVATE_KEY_PEM };
      // A passphrase belongs to the real key; the placeholder has none.
      delete node.passphrase;
      substituted.push(key);
      return;
    }
    for (const [childKey, child] of Object.entries(node)) walk(child, childKey);
  };

  for (const [key, value] of Object.entries(copy)) walk(value, key);
  return { declaration: copy, substituted };
}
