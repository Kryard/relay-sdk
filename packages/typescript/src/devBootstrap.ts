/**
 * devBootstrap.ts — DEV-ONLY convenience for the open-source signer.
 *
 * Stand up a ready-to-use {@link KryardClient} against a Kryard signer running
 * locally in dev mode, with **no managed account**: it self-mints a throwaway org +
 * API key through the *unauthenticated* dev bootstrap the API exposes only when
 * started with `DEV_ADMIN_ENABLED=true` (`POST /admin/dev/org`,
 * `POST /admin/dev/api-key`).
 *
 * NEVER point this at a public deployment — those endpoints are the bootstrap and
 * bypass X-Stamp auth on purpose. To also *sign* locally, run the API with
 * `POLICY_BYPASS_ALLOWED=true` (zero policy bindings → allowed through) or seed a
 * policy. Creating keys and queries work without it.
 */
import { p256 } from "@noble/curves/p256";
import { bytesToHex } from "@noble/hashes/utils";
import { KryardClient } from "./wallet.js";
import { createApiKeyStamper } from "./stamper.js";
import type { FetchFn } from "./client.js";

export interface BootstrapLocalClientOptions {
  /** Base URL of a locally-running Kryard API in dev mode. Default `http://localhost:8787`. */
  baseUrl?: string;
  /** Display name for the throwaway org. Default `"sdk-local"`. */
  orgName?: string;
  /**
   * Reuse an existing API keypair (compressed P-256 public key + private key, hex)
   * — e.g. to keep the same org across runs. A fresh keypair is generated if omitted.
   */
  apiKey?: { apiPublicKey: string; apiPrivateKey: string };
  /** Value for the `X-Dev-Admin-Token` header, if the dev bootstrap is token-gated. */
  devAdminToken?: string;
  /** Custom fetch (e.g. for tests). Default global `fetch`. */
  fetchFn?: FetchFn;
}

export interface BootstrapLocalClientResult {
  /** A KryardClient that stamps with the freshly-minted key. */
  client: KryardClient;
  organizationId: string;
  actorId: string;
  /** The minted API key — persist it (via `apiKey`) to reuse this org on the next run. */
  apiPublicKey: string;
  apiPrivateKey: string;
}

/**
 * Mint a local org + API key and return a ready {@link KryardClient}. Dev-only.
 *
 * ```ts
 * const { client } = await bootstrapLocalClient(); // http://localhost:8787
 * await client.createPrivateKey({ name: "local-evm", curve: "CURVE_SECP256K1" });
 * ```
 */
export async function bootstrapLocalClient(
  opts: BootstrapLocalClientOptions = {},
): Promise<BootstrapLocalClientResult> {
  const baseUrl = (opts.baseUrl ?? "http://localhost:8787").replace(/\/+$/, "");
  const fetchFn: FetchFn = opts.fetchFn ?? (globalThis.fetch.bind(globalThis) as FetchFn);

  // 1. API keypair (compressed P-256), generated unless supplied.
  const apiPrivateKey = opts.apiKey?.apiPrivateKey ?? bytesToHex(p256.utils.randomPrivateKey());
  const apiPublicKey = opts.apiKey?.apiPublicKey ?? bytesToHex(p256.getPublicKey(apiPrivateKey, true));

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.devAdminToken) headers["X-Dev-Admin-Token"] = opts.devAdminToken;

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `dev bootstrap POST ${path} failed (${res.status})${detail ? `: ${detail}` : ""} — ` +
          `is the API running with DEV_ADMIN_ENABLED=true?`,
      );
    }
    return (await res.json()) as T;
  }

  // 2. Mint an org (+ default actor) via the unauthenticated dev bootstrap.
  const org = await postJson<{ organizationId: string; actorId: string }>("/admin/dev/org", {
    name: opts.orgName ?? "sdk-local",
  });

  // 3. Register our public key as an API key for that org/actor.
  await postJson<{ apiKeyId: string }>("/admin/dev/api-key", {
    organizationId: org.organizationId,
    actorId: org.actorId,
    publicKey: apiPublicKey,
  });

  // 4. A ready client that stamps with the minted key.
  const client = new KryardClient({
    baseUrl,
    organizationId: org.organizationId,
    stamper: createApiKeyStamper({ apiPublicKey, apiPrivateKey }),
    fetchFn,
  });

  return {
    client,
    organizationId: org.organizationId,
    actorId: org.actorId,
    apiPublicKey,
    apiPrivateKey,
  };
}
