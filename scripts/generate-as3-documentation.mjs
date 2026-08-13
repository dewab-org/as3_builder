#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}

const schemaOption = option("--schema");
const outputOption = option("--output");
const as3SourceOption = option("--as3-source");
const mappingsOption = option("--mappings");
const mappingsOutputOption = option("--mappings-output");
const schemaUrl = schemaOption
  ? pathToFileURL(resolve(schemaOption))
  : new URL("../src/schemas/as3-schema-3.56.0-10.json", import.meta.url);
const outputUrl = outputOption
  ? pathToFileURL(resolve(outputOption))
  : new URL(
      "../src/schemas/as3-documentation-3.56.0-10.json",
      import.meta.url
    );
const schemaText = await readFile(schemaUrl, "utf8");
const schema = JSON.parse(schemaText);
const schemaSha256 = createHash("sha256").update(schemaText).digest("hex");
const defaultMappingsUrl = new URL(
  "../src/schemas/as3-implementation-mappings-3.56.0-10.json",
  import.meta.url
);
const mappingsUrl = mappingsOption
  ? pathToFileURL(resolve(mappingsOption))
  : defaultMappingsUrl;
const implementation = as3SourceOption
  ? await loadImplementation(resolve(as3SourceOption))
  : JSON.parse(await readFile(mappingsUrl, "utf8"));
if (mappingsOutputOption) {
  await writeFile(
    pathToFileURL(resolve(mappingsOutputOption)),
    `${JSON.stringify(implementation, null, 2)}\n`
  );
}

const F5_DOC_ROOT =
  "https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest";

// These are operational inspection equivalents, not imperative replacements
// for AS3. A single declaration object can expand to several BIG-IP objects.
// Add only mappings whose BIG-IP object/property names are stable and useful.
const OBJECT_TMSH = {
  Tenant: tmsh("auth partition", "list auth partition <tenant>"),
  Service_HTTP: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Service_HTTPS: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Service_TCP: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Service_UDP: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Service_SCTP: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Service_L4: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Service_Generic: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Service_Forwarding: tmsh("ltm virtual", "list ltm virtual /<tenant>/<application>/<name>"),
  Pool: tmsh("ltm pool", "list ltm pool /<tenant>/<application>/<name>"),
  HTTP_Profile: tmsh("ltm profile http", "list ltm profile http /<tenant>/<application>/<name>"),
  HTTP2_Profile: tmsh("ltm profile http2", "list ltm profile http2 /<tenant>/<application>/<name>"),
  TCP_Profile: tmsh("ltm profile tcp", "list ltm profile tcp /<tenant>/<application>/<name>"),
  UDP_Profile: tmsh("ltm profile udp", "list ltm profile udp /<tenant>/<application>/<name>"),
  DNS_Profile: tmsh("ltm profile dns", "list ltm profile dns /<tenant>/<application>/<name>"),
  TLS_Server: tmsh("ltm profile client-ssl", "list ltm profile client-ssl /<tenant>/<application>/<name>"),
  TLS_Client: tmsh("ltm profile server-ssl", "list ltm profile server-ssl /<tenant>/<application>/<name>"),
  iRule: tmsh("ltm rule", "list ltm rule /<tenant>/<application>/<name>"),
  Data_Group: tmsh("ltm data-group internal", "list ltm data-group internal /<tenant>/<application>/<name>"),
  SNAT_Pool: tmsh("ltm snatpool", "list ltm snatpool /<tenant>/<application>/<name>"),
  SNAT_Translation: tmsh("ltm snat-translation", "list ltm snat-translation /<tenant>/<application>/<name>"),
  Policy: tmsh("ltm policy", "list ltm policy /<tenant>/<application>/<name>"),
  GSLB_Data_Center: tmsh("gtm datacenter", "list gtm datacenter /<tenant>/<name>"),
  GSLB_Server: tmsh("gtm server", "list gtm server /<tenant>/<name>"),
  GSLB_Pool: tmsh("gtm pool", "list gtm pool /<tenant>/<name>"),
  GSLB_Domain: tmsh("gtm wideip", "list gtm wideip /<tenant>/<name>"),
};

const FIELD_TMSH = {
  "Service_Core.virtualAddresses": property("destination", "ltm virtual"),
  "Service_Core.virtualPort": property("destination", "ltm virtual"),
  "Service_HTTP.virtualPort": property("destination", "ltm virtual"),
  "Service_HTTPS.virtualPort": property("destination", "ltm virtual"),
  "Service_Core.pool": property("pool", "ltm virtual"),
  "Service_Core.snat": property("source-address-translation", "ltm virtual"),
  "Service_Core.iRules": property("rules", "ltm virtual"),
  "Service_Core.persistenceMethods": property("persist", "ltm virtual"),
  "Service_Core.translateServerAddress": property("translate-address", "ltm virtual"),
  "Service_Core.translateServerPort": property("translate-port", "ltm virtual"),
  "Pool.loadBalancingMode": property("load-balancing-mode", "ltm pool"),
  "Pool.minimumMembersActive": property("min-active-members", "ltm pool"),
  "Pool.monitors": property("monitor", "ltm pool"),
  "Pool.serviceDownAction": property("service-down-action", "ltm pool"),
  "Pool.slowRampTime": property("slow-ramp-time", "ltm pool"),
  "Pool_Member.connectionLimit": property("connection-limit", "ltm pool members"),
  "Pool_Member.dynamicRatio": property("dynamic-ratio", "ltm pool members"),
  "Pool_Member.priorityGroup": property("priority-group", "ltm pool members"),
  "Pool_Member.rateLimit": property("rate-limit", "ltm pool members"),
  "Pool_Member.ratio": property("ratio", "ltm pool members"),
  "Pool_Member.servicePort": property("member address:service-port", "ltm pool members"),
  "Monitor_HTTP.interval": property("interval", "ltm monitor http"),
  "Monitor_HTTP.timeout": property("timeout", "ltm monitor http"),
  "Monitor_HTTP.send": property("send", "ltm monitor http"),
  "Monitor_HTTP.receive": property("recv", "ltm monitor http"),
  "TLS_Server.certificates": property("cert/key/chain", "ltm profile client-ssl"),
  "TLS_Server.ciphers": property("ciphers", "ltm profile client-ssl"),
  "TLS_Client.ciphers": property("ciphers", "ltm profile server-ssl"),
};

const BEHAVIOR = {
  "Application.enable":
    "Controls whether the application handles traffic. Disabling an application preserves its declaration while preventing its services from accepting traffic.",
  "Service_Core.virtualAddresses":
    "Creates the destination address portion of the BIG-IP virtual server. Address objects may also carry route-domain, traffic-group, and advertisement behavior through Service_Address declarations.",
  "Service_Core.pool":
    "Selects the default pool used when no higher-priority traffic policy or iRule chooses another target. A use pointer refers to a declaration object; a bigip pointer refers to an existing BIG-IP object.",
  "Service_Core.snat":
    "Controls source-address translation for server-side connections. Automap uses self IP addresses; none preserves the client source; a SNAT pool reference selects declared or existing translation addresses.",
  "Pool.minimumMembersActive":
    "Sets BIG-IP min-active-members for priority-group activation. Traffic remains confined to the highest available priority group while it has at least this many active members; when it falls below the threshold, BIG-IP activates members in the next lower priority group. This does not mark the pool down.",
  "Pool.loadBalancingMode":
    "Selects the algorithm BIG-IP uses for new member selection. Round-robin cycles evenly; ratio modes weight selections by configured ratios; least-connections modes prefer the least-loaded member or node; observed and predictive modes use measured connection history or trends; fastest modes use response measurements; weighted least-connections compares utilization against configured connection limits.",
  "Pool.minimumMonitors":
    "Defines how many associated monitors must succeed for a member to be considered available; all requires every associated monitor to succeed.",
  "Pool.monitors":
    "Attaches the monitor rule BIG-IP uses to decide whether the pool can receive load-balanced traffic. Multiple monitors may be combined, and minimumMonitors controls how many must succeed.",
  "Pool.reselectTries":
    "Controls passive-failure recovery. Zero disables reselection after a member connection failure; a positive value lets BIG-IP try another member up to the configured number of times.",
  "Pool.serviceDownAction":
    "Controls traffic handling after the selected service is marked down: none takes no special action, drop discards the affected traffic, reset terminates the flow, and reselect chooses another member for the next packet of a Layer 4 connection.",
  "Pool.slowRampTime":
    "Gradually increases a newly enabled or newly healthy member's share of new traffic over this many seconds. Before the interval elapses the member receives traffic in proportion to how long it has been up; this is especially useful with least-connections-member.",
  "Pool.allowNATEnabled":
    "Maps to BIG-IP allow-nat. When enabled, this pool may load-balance connections using network address translation.",
  "Pool.allowSNATEnabled":
    "Maps to BIG-IP allow-snat. When enabled, this pool may load-balance connections using source network address translation.",
  "Pool_Member.connectionLimit":
    "Caps concurrent connections to this member. Zero means no configured limit; weighted-least-connections modes depend on meaningful limits to compare member utilization.",
  "Pool_Member.priorityGroup":
    "Assigns the member to a priority group. BIG-IP prefers higher-numbered groups and activates lower groups when the pool's minimumMembersActive threshold is no longer met.",
  "Pool_Member.rateLimit":
    "Caps new connections per second to this member. The AS3 sentinel value -1 maps to BIG-IP disabled; zero prevents the member from receiving new connections.",
  "Pool_Member.ratio":
    "Supplies the static member weight used by ratio-based load-balancing modes. Larger values receive a proportionally larger share when the selected algorithm uses member ratios.",
  "Pool_Member.enable":
    "Maps to BIG-IP pool-member administrative state. Disabling/offlining a member affects new selection and, depending on state, can terminate existing connections.",
  "Service_HTTP.virtualPort":
    "Defines the listening port for the HTTP virtual server. An integer produces the destination port directly; a Firewall_Port_List reference causes AS3 to create traffic-matching criteria on supported BIG-IP versions.",
};

function tmsh(objectType, inspectionCommand) {
  return { objectType, inspectionCommand };
}

function property(propertyName, objectType) {
  return { objectType, property: propertyName };
}

async function loadImplementation(root) {
  const classesPath = join(root, "src/lib/classes.js");
  const propertiesPath = join(root, "src/lib/properties.json");
  const packagePath = join(root, "package.json");
  const require = createRequire(import.meta.url);
  const classesText = await readFile(classesPath, "utf8");
  const propertiesText = await readFile(propertiesPath, "utf8");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const classes = require(classesPath).toMcp;
  return {
    classes,
    properties: JSON.parse(propertiesText),
    provenance: {
      repository: "https://github.com/F5Networks/f5-appsvcs-extension",
      version: packageJson.version,
      license: "Apache-2.0",
      classesFile: "src/lib/classes.js",
      classesSha256: createHash("sha256").update(classesText).digest("hex"),
      propertiesFile: "src/lib/properties.json",
      propertiesSha256: createHash("sha256").update(propertiesText).digest("hex"),
    },
  };
}

function nonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function inheritedKey(table, definitionName, fieldName) {
  const exact = `${definitionName}.${fieldName}`;
  if (table[exact]) return exact;
  const bases = [];
  if (definitionName.startsWith("Service_")) {
    bases.push("Service_Core", "Service_L4_Core", "Service_HTTP_Core", "Service_TCP_Core", "Service_UDP_Core");
  }
  for (const base of bases) {
    const candidate = `${base}.${fieldName}`;
    if (table[candidate]) return candidate;
  }
  return exact;
}

const DEFINITION_OBJECT_TYPES = {
  Pool_Member: "ltm pool members",
  Policy_Action: "ltm policy rules actions",
  Policy_Condition: "ltm policy rules conditions",
  Policy_Rule: "ltm policy rules",
};

function normalizeTypes(value) {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value : [];
}

function implementationObjectTypes(definitionName, classValue) {
  if (!implementation) return [];
  const aliases = [classValue, definitionName];
  if (definitionName.startsWith("Monitor_")) aliases.push("Monitor");
  if (definitionName.startsWith("GSLB_Monitor_")) aliases.push("GSLB_Monitor");
  const inheritedClass = Object.keys(implementation.classes)
    .filter((candidate) => definitionName.startsWith(`${candidate}_`))
    .sort((a, b) => b.length - a.length)[0];
  if (inheritedClass) aliases.push(inheritedClass);
  for (const alias of aliases) {
    if (alias && implementation.classes[alias]) {
      return normalizeTypes(implementation.classes[alias]);
    }
  }
  return normalizeTypes(DEFINITION_OBJECT_TYPES[definitionName]);
}

function tmshReference(objectType) {
  const [module] = objectType.split(" ");
  const page = objectType.replaceAll(" ", "_");
  return `https://clouddocs.f5.com/cli/tmsh-reference/latest/modules/${module}/${page}.html`;
}

function camelCaseTmsh(id) {
  return id.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function propertyTables(objectType) {
  const tables = [];
  let candidate = objectType;
  if (implementation?.properties[candidate]) tables.push(candidate);
  for (const child of Object.keys(implementation?.properties ?? {})
    .filter((key) => key.startsWith(`${objectType} `))
    .sort((a, b) => a.split(" ").length - b.split(" ").length)) {
    tables.push(child);
  }
  candidate = candidate.slice(0, candidate.lastIndexOf(" "));
  while (candidate.includes(" ")) {
    if (implementation?.properties[candidate] && !tables.includes(candidate)) {
      tables.push(candidate);
    }
    candidate = candidate.slice(0, candidate.lastIndexOf(" "));
  }
  return tables;
}

function implementationFieldMapping(definitionName, classValue, fieldName) {
  const objectTypes = implementationObjectTypes(definitionName, classValue);
  for (const objectType of objectTypes) {
    for (const table of propertyTables(objectType)) {
      const record = implementation.properties[table].find((item) => {
        const as3Name = item.altId ?? camelCaseTmsh(item.id);
        return as3Name === fieldName;
      });
      if (!record) continue;
      const mapping = {
        objectType,
        property: record.id,
        reference: tmshReference(objectType),
        mappingSource: implementation.provenance.propertiesFile,
      };
      if (record.truth !== undefined || record.falsehood !== undefined) {
        mapping.valueMap = {
          true: record.truth,
          false: record.falsehood,
        };
      }
      if (record.extend) mapping.expansion = record.extend;
      if (record.quotedString) mapping.quotedString = true;
      return mapping;
    }
  }
  return undefined;
}

function pointerBehavior(node) {
  const text = JSON.stringify(node);
  if (!text.includes('"tag":"pointer"') && !node.properties?.use && !node.properties?.bigip) {
    return undefined;
  }
  return "A use pointer selects an object declared and managed by AS3; a bigip pointer attaches an existing BIG-IP object that AS3 does not create or own. Pointer changes therefore alter object dependencies as well as the configured value.";
}

function mappedBehavior(schemaDescription, mapping, node) {
  const details = [];
  if (schemaDescription) details.push(schemaDescription);
  details.push(
    `AS3 maps this field to ${mapping.objectType} property ${mapping.property}.`
  );
  if (mapping.valueMap) {
    details.push(
      `Boolean values are rendered as ${mapping.valueMap.true} and ${mapping.valueMap.false}.`
    );
  }
  if (mapping.expansion) {
    details.push(`The value expands into ${mapping.expansion} tmsh configuration.`);
  }
  const pointer = pointerBehavior(node);
  if (pointer) details.push(pointer);
  return details.join(" ");
}

function decodePointerPart(part) {
  return part.replace(/~1/g, "/").replace(/~0/g, "~");
}

function dereference(node) {
  if (!node || typeof node !== "object" || typeof node.$ref !== "string") return node;
  if (!node.$ref.startsWith("#/")) return node;
  let value = schema;
  for (const part of node.$ref.slice(2).split("/")) value = value[decodePointerPart(part)];
  return value;
}

function collectObjectShape(input, seen = new Set()) {
  if (!input || typeof input !== "object") {
    return { properties: {}, required: new Set(), conditionallyRequired: new Set() };
  }
  const node = dereference(input);
  if (seen.has(node)) {
    return { properties: {}, required: new Set(), conditionallyRequired: new Set() };
  }
  const nextSeen = new Set(seen).add(node);
  const properties = {};
  const required = new Set(node.required ?? []);
  const conditionallyRequired = new Set();

  for (const branch of node.allOf ?? []) {
    const child = collectObjectShape(branch, nextSeen);
    Object.assign(properties, child.properties);
    for (const name of child.required) required.add(name);
    for (const name of child.conditionallyRequired) conditionallyRequired.add(name);
  }
  for (const branch of [
    ...(node.anyOf ?? []),
    ...(node.oneOf ?? []),
    ...(node.then ? [node.then] : []),
    ...(node.else ? [node.else] : []),
  ]) {
    const child = collectObjectShape(branch, nextSeen);
    Object.assign(properties, child.properties);
    for (const name of child.required) conditionallyRequired.add(name);
    for (const name of child.conditionallyRequired) conditionallyRequired.add(name);
  }
  Object.assign(properties, node.properties ?? {});
  return { properties, required, conditionallyRequired };
}

function effective(node, seen = new Set()) {
  if (!node || typeof node !== "object") return {};
  const resolved = dereference(node);
  if (seen.has(resolved)) return resolved;
  const nextSeen = new Set(seen).add(resolved);
  const merged = {};
  for (const part of resolved.allOf ?? []) Object.assign(merged, effective(part, nextSeen));
  return { ...merged, ...resolved };
}

function schemaTypes(node, seen = new Set()) {
  if (!node || typeof node !== "object") return ["any"];
  const resolved = effective(node, seen);
  if (resolved.const !== undefined) return [typeof resolved.const];
  if (Array.isArray(resolved.type)) return resolved.type;
  if (typeof resolved.type === "string") return [resolved.type];
  const branches = resolved.oneOf ?? resolved.anyOf;
  if (branches) return [...new Set(branches.flatMap((part) => schemaTypes(part, seen)))];
  if (resolved.properties) return ["object"];
  if (resolved.items) return ["array"];
  return ["any"];
}

function allowedValues(node) {
  const resolved = effective(node);
  const result = {};
  if (resolved.const !== undefined) result.const = resolved.const;
  if (Array.isArray(resolved.enum)) result.enum = resolved.enum;
  for (const key of [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
  ]) {
    if (resolved[key] !== undefined) result[key] = resolved[key];
  }
  const branches = resolved.oneOf ?? resolved.anyOf;
  if (branches) result.alternatives = branches.map((part) => ({
    types: schemaTypes(part),
    ...allowedValues(part),
  }));
  return result;
}

function fieldEntry(
  definitionName,
  classValue,
  name,
  raw,
  required,
  conditionallyRequired
) {
  const node = effective(raw);
  const schemaDescription = nonEmpty(node.description, node.title);
  const behaviorKey = inheritedKey(BEHAVIOR, definitionName, name);
  const mappingKey = inheritedKey(FIELD_TMSH, definitionName, name);
  const mapping =
    implementationFieldMapping(definitionName, classValue, name) ??
    FIELD_TMSH[mappingKey];
  if (mapping && !mapping.reference) {
    mapping.reference = tmshReference(
      Array.isArray(mapping.objectType) ? mapping.objectType[0] : mapping.objectType
    );
  }
  const curatedBehavior = BEHAVIOR[behaviorKey];
  const pointer = pointerBehavior(node);
  const entry = {
    title: nonEmpty(node.title, name),
    types: schemaTypes(raw),
    required,
    conditionallyRequired,
    schemaDescription: schemaDescription ?? "No field description is present in the bundled F5 schema.",
    behavior:
      curatedBehavior ??
      (mapping ? mappedBehavior(schemaDescription, mapping, node) : undefined) ??
      pointer ??
      "No behavioral expansion was found in the F5 AS3 implementation or curated TMOS references; only the schema constraints are known.",
    behaviorSource: curatedBehavior
      ? "curated-tmos"
      : mapping
        ? "as3-implementation-mapping"
        : pointer
          ? "as3-pointer-semantics"
          : "schema-only",
    allowed: allowedValues(raw),
  };
  if (node.default !== undefined) entry.default = node.default;
  if (mapping) entry.tmsh = mapping;
  return entry;
}

const definitions = {};
for (const [name, raw] of Object.entries(schema.definitions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
  const node = effective(raw);
  const shape = collectObjectShape(raw);
  const classValue = shape.properties.class
    ? effective(shape.properties.class).const
    : undefined;
  const fields = {};
  for (const [fieldName, fieldSchema] of Object.entries(shape.properties).sort(([a], [b]) => a.localeCompare(b))) {
    fields[fieldName] = fieldEntry(
      name,
      classValue,
      fieldName,
      fieldSchema,
      shape.required.has(fieldName),
      shape.conditionallyRequired.has(fieldName)
    );
  }
  const objectTypes = implementationObjectTypes(name, classValue);
  const objectMapping = objectTypes.length
    ? {
        objectType: objectTypes.length === 1 ? objectTypes[0] : objectTypes,
        inspectionCommand: `list ${objectTypes[0]} <name>`,
        reference:
          objectTypes.length === 1
            ? tmshReference(objectTypes[0])
            : objectTypes.map(tmshReference),
        mappingSource: implementation.provenance.classesFile,
      }
    : OBJECT_TMSH[name];
  const entry = {
    title: nonEmpty(node.title, name),
    types: schemaTypes(raw),
    schemaDescription: nonEmpty(
      node.description,
      node.title,
      "No definition description is present in the bundled F5 schema."
    ),
    behavior: objectMapping
      ? `${nonEmpty(node.description, node.title, name)} AS3 materializes this declaration as ${objectTypes.join(" or ") || objectMapping.objectType} BIG-IP configuration; AS3 owns its lifecycle unless the declaration uses a bigip pointer to an existing object.`
      : "No object-level behavioral expansion was found in the F5 AS3 implementation; this reusable definition supplies validation or nested declaration structure.",
    behaviorSource: objectMapping
      ? implementation
        ? "as3-implementation-mapping"
        : "curated-tmos"
      : "schema-only",
    allowedFields: Object.keys(fields),
    fields,
    documentation: {
      schemaReference: `${F5_DOC_ROOT}/refguide/schemaref/${encodeURIComponent(name)}.schema.json.html`,
    },
  };
  if (typeof classValue === "string") entry.class = classValue;
  if (objectMapping) entry.tmsh = objectMapping;
  definitions[name] = entry;
}

const output = {
  format: "f5-as3-description-augmentation",
  formatVersion: 1,
  generatedFrom: {
    schemaFile: fileURLToPath(schemaUrl).split("/").pop(),
    schemaId: schema.$id,
    schemaVersion: "3.56.0-10",
    schemaSha256,
    implementation: implementation?.provenance,
  },
  documentation: {
    schemaReference: `${F5_DOC_ROOT}/refguide/schema-reference.html`,
    declarationPurpose: `${F5_DOC_ROOT}/refguide/declaration-purpose-function.html`,
    tmshReference: "https://clouddocs.f5.com/cli/tmsh-reference/latest/",
  },
  tmshNotice:
    "TMOS entries identify operationally equivalent BIG-IP objects/properties for inspection. AS3 remains the source of truth; names are tenant/application scoped, and one AS3 object may expand into multiple BIG-IP objects. Do not replay inspection examples as a replacement deployment workflow.",
  definitionCount: Object.keys(definitions).length,
  definitions,
};

await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.definitionCount} definitions to ${fileURLToPath(outputUrl)}`);
