import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { test } from "node:test";
import { fetchLegacyDeviceConfigurations } from "../../src/scan/deviceConfigurations.js";
import { buildSettingIndex } from "../../src/scan/index.js";
import { withCatalog } from "../catalog.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const THUMB = "754152EDEFCB93707CBD8CB4A1483DCFE12FCAB8";
const PUBLISHER = `./Device/Vendor/MSFT/RootCATrustedCertificates/TrustedPublisher/${THUMB}/EncodedCertificate`;

/** A custom profile as a live tenant returns it to a read-only app — confirmed: text and file values come back as "****". */
function profile(id: string, name: string, rows: unknown[], assignments: unknown[] = [{ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } }]) {
  return { id, displayName: name, "@odata.type": "#microsoft.graph.windows10CustomConfiguration", assignments, omaSettings: rows };
}

test("custom OMA-URI: every row is a setting, keyed by its path, with what a read-only scan can know of its value", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  global.fetch = withCatalog(async () =>
    json({
      value: [
        profile("p1", "Office trusted publishers", [
          { "@odata.type": "#microsoft.graph.omaSettingBase64", displayName: "Trusted publisher: Contoso code signing", omaUri: PUBLISHER, isEncrypted: true, fileName: "contoso.cer", value: "KioqKg==" },
          // What v1.0 sends — no isEncrypted at all, only the mask.
          { "@odata.type": "#microsoft.graph.omaSettingString", displayName: "Some string", omaUri: "./Device/Vendor/MSFT/Policy/Config/Start/HideAppList", value: "****" },
          { "@odata.type": "#microsoft.graph.omaSettingBase64", displayName: "Masked file", omaUri: "./Vendor/MSFT/Masked/File", fileName: "masked.cer", value: "KioqKg==" },
          { "@odata.type": "#microsoft.graph.omaSettingInteger", displayName: "", omaUri: "./Device/Vendor/MSFT/Policy/Config/Experience/AllowCortana", isEncrypted: false, value: 0 },
          { "@odata.type": "#microsoft.graph.omaSettingBoolean", displayName: "Flag", omaUri: " ", value: true },
        ]),
        // Paths aren't case-sensitive on Windows: the same certificate from a second profile is the same setting.
        profile("p2", "Old publishers", [
          { "@odata.type": "#microsoft.graph.omaSettingBase64", displayName: "Contoso (old profile)", omaUri: PUBLISHER.toLowerCase(), isEncrypted: true, fileName: "contoso.cer", value: "KioqKg==" },
        ]),
        profile("p3", "Nothing in it", []),
      ],
    }),
  );

  const policies = await fetchLegacyDeviceConfigurations("token");
  assert.deepEqual(policies.map((p) => p.name), ["Office trusted publishers", "Old publishers"]);
  const [publisher, text, maskedFile, number] = policies[0].settings;
  assert.equal(policies[0].settings.length, 4, "a row without a path is left out");
  assert.equal(maskedFile.value, "masked.cer (encrypted)");
  assert.deepEqual(publisher, {
    settingDefinitionId: `omauri:${PUBLISHER.toLowerCase()}`,
    name: "Trusted publisher: Contoso code signing",
    cspPath: PUBLISHER,
    category: "Custom OMA-URI",
    value: "contoso.cer (encrypted)",
  });
  assert.equal(text.value, "Encrypted");
  // A row with no name of its own is named after the end of its path.
  assert.deepEqual([number.name, number.value], ["AllowCortana", "0"]);

  const entry = buildSettingIndex(policies).find((e) => e.cspPath === PUBLISHER)!;
  assert.deepEqual(entry.sources.map((s) => s.policyName), ["Office trusted publishers", "Old publishers"]);
});

test("custom OMA-URI: a certificate Intune didn't encrypt is named, with its expiry", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  // A real self-signed code-signing certificate, made with openssl for this test (public part only).
  const der = Buffer.from(CERT_BASE64, "base64");
  const expires = new Date(new X509Certificate(der).validTo).toISOString().slice(0, 10);
  global.fetch = withCatalog(async () =>
    json({ value: [profile("p1", "Publishers", [{ "@odata.type": "#microsoft.graph.omaSettingBase64", displayName: "Cert", omaUri: PUBLISHER, isEncrypted: false, fileName: "x.cer", value: CERT_BASE64 }])] }),
  );
  const [policy] = await fetchLegacyDeviceConfigurations("token");
  assert.equal(policy.settings[0].value, `Certificate: IntuneAtlas Test Code Signing, expires ${expires}`);
});

const CERT_BASE64 = "MIIDfDCCAmSgAwIBAgIUfMjFpwtz4JKyDt84O+gmu5V0oF8wDQYJKoZIhvcNAQELBQAwQzEmMCQGA1UEAwwdSW50dW5lQXRsYXMgVGVzdCBDb2RlIFNpZ25pbmcxGTAXBgNVBAoMEGludHVuZWF0bGFzLXRlc3QwHhcNMjYxMDE0MDg1MzQ2WhcNMjcxMTE4MDg1MzQ2WjBDMSYwJAYDVQQDDB1JbnR1bmVBdGxhcyBUZXN0IENvZGUgU2lnbmluZzEZMBcGA1UECgwQaW50dW5lYXRsYXMtdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL1uBE9GU+x4Tm0PdAYBF02CJLdczeVz+cKy/gD6opc3Go84rEBgsIzruKHWLDcodC2OimZrb9/D8y6KV1bOskTh218/SBSUPUX4x8PfQg5YeV8YU4PgWn+M6g2cvvB2Ndg95vDQizwotlA5A35oJkNtU78YlR0g6VXfE/xgFfWBeiwXyOTB4fSwjT9ZdICP2nr+q19DuG2HMAJHO0u9e+hZv1/RiRNlNIcDkB7I2lvFDn6ogY/7jl1Lk0GqRQLq3CYwenSuge758VZ7abYxLRy9oOVtYsVsORXm5MUZ/8sDbHIcbfmQzLlZ7JL6uRZfUh2Uf+y3qOC5dGoXdisK3rUCAwEAAaNoMGYwHQYDVR0OBBYEFMU4SzDp+UOvdfw0No3k3+9WeUvnMB8GA1UdIwQYMBaAFMU4SzDp+UOvdfw0No3k3+9WeUvnMA8GA1UdEwEB/wQFMAMBAf8wEwYDVR0lBAwwCgYIKwYBBQUHAwMwDQYJKoZIhvcNAQELBQADggEBAKGQvvDgullFdXrkGbRMOFgU5ejN7x8EoWKXb7dreLCELGGttwej5eNnOcxcgvM8a6pgGveLZ13ezSwtkawvIIH/yOL4ZaSNLkB8NQKF3xzh3jxOUoN7RnT8rY5+OH5aacsppqlyJAkkLqRcAXkOIu/qSSKmeSYqS5vjZdoJVXOgdOEKNqWXyDeOhC76NdghZqGyB5KmxVxec4QswQxrbWneM0YNNSyT5ch1nv+vfx+aHKI0xqMorqbcZnfcUL6xbw9HXArvewI/WjMY0zmAI+PI4f/o/1OyQSay0FHZxTPBnj6XrTkHlMcoLBijdBLtEoFr9YaaVsh+0hAjAYcUBLo=";
