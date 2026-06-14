import { describe, it, expect } from "vitest";
import { bootstrapLocalClient } from "../src/devBootstrap.js";
import { KryardClient } from "../src/wallet.js";
import type { FetchFn } from "../src/client.js";

/** A fetch stub that records calls and answers the two dev-bootstrap routes. */
function mockFetch() {
  const calls: { url: string; init: RequestInit | undefined; body: Record<string, unknown> }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    calls.push({ url, init, body });
    if (url.endsWith("/admin/dev/org")) {
      return ok({ organizationId: "org-test", actorId: "actor-test", actorName: "dev-actor" });
    }
    if (url.endsWith("/admin/dev/api-key")) {
      return ok({ apiKeyId: "key-test" });
    }
    return notFound("unexpected route");
  };
  return { fetchFn, calls };
}

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}
function notFound(text: string) {
  return { ok: false, status: 404, json: async () => ({}), text: async () => text };
}

describe("bootstrapLocalClient", () => {
  it("mints an org + api key and returns a ready client", async () => {
    const { fetchFn, calls } = mockFetch();
    const res = await bootstrapLocalClient({ fetchFn, baseUrl: "http://localhost:8787/" }); // trailing slash trimmed

    expect(res.client).toBeInstanceOf(KryardClient);
    expect(res.organizationId).toBe("org-test");
    expect(res.actorId).toBe("actor-test");

    // a fresh compressed P-256 keypair (33-byte pubkey = 66 hex, 02/03 prefix; 32-byte priv)
    expect(res.apiPublicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(res.apiPrivateKey).toMatch(/^[0-9a-f]{64}$/);

    // exactly the two bootstrap calls, in order, against the trimmed base url
    expect(calls.map((c) => c.url)).toEqual([
      "http://localhost:8787/admin/dev/org",
      "http://localhost:8787/admin/dev/api-key",
    ]);

    // the registered public key is the one the client will stamp with
    expect(calls[1].body).toMatchObject({
      organizationId: "org-test",
      actorId: "actor-test",
      publicKey: res.apiPublicKey,
    });
  });

  it("reuses a supplied keypair and sets the dev-admin token header", async () => {
    const { fetchFn, calls } = mockFetch();
    const apiKey = { apiPublicKey: "02" + "ab".repeat(32), apiPrivateKey: "cd".repeat(32) };

    const res = await bootstrapLocalClient({ fetchFn, apiKey, devAdminToken: "secret" });

    expect(res.apiPublicKey).toBe(apiKey.apiPublicKey);
    expect(res.apiPrivateKey).toBe(apiKey.apiPrivateKey);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["X-Dev-Admin-Token"]).toBe("secret");
  });

  it("throws a helpful error when the bootstrap is unavailable", async () => {
    const fetchFn: FetchFn = async () => notFound("dev admin disabled");
    await expect(bootstrapLocalClient({ fetchFn })).rejects.toThrow(
      /dev bootstrap POST \/admin\/dev\/org failed \(404\).*DEV_ADMIN_ENABLED/s,
    );
  });
});
