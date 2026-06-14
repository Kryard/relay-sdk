# @kryard/sdk

A client for **Kryard's Turnkey-compatible wallet infrastructure**:

- **Wallets & signing** — create secp256k1 keys, sign raw payloads and EVM
  transactions through Kryard's Turnkey-shaped activity API (X-Stamp authed).
- **Key export** — pull a key out as an HPKE-sealed bundle (RFC 9180) and recover
  it locally; the plaintext never leaves the signer except encrypted to you.
- **Managed EIP-7702 relay** — a user signs a 7702 authorization + batch digest;
  Kryard signs, fronts gas, and broadcasts the type-4 transaction (gasless, batched,
  no 4337 bundler). Optionally the user pays gas in any **ERC-20**.

All three share the same `X-Stamp` API-key stamper. Pairs with the on-chain
`KryardDelegate` and Kryard's public API.

## Install

Published to both npm and GitHub Packages (same version):

```bash
# npm (public)
npm i @kryard/sdk viem
```

From **GitHub Packages**, add to your `.npmrc` first:

```
@kryard:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}   # a PAT with read:packages
```

then `npm i @kryard/sdk viem`.

## Quick start

```ts
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { KryardRelayClient, createApiKeyStamper, sponsorExecute, type UserSigner, type Call } from "@kryard/sdk";

// 1. The Kryard relay client (the relayer ORG's API key stamps the request).
const client = new KryardRelayClient({
  baseUrl: "https://api.kryard.com",
  organizationId: process.env.KRYARD_ORG!,
  stamper: createApiKeyStamper({
    apiPublicKey: process.env.KRYARD_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.KRYARD_API_PRIVATE_KEY!,
  }),
});

// 2. Adapt the USER's wallet to the UserSigner interface.
const account = privateKeyToAccount(process.env.USER_PK as Hex);
const wallet = createWalletClient({ account, chain: sepolia, transport: http() });
const signer: UserSigner = {
  address: account.address,
  signDigest: (digest) => account.signMessage({ message: { raw: digest } }),
  async signAuthorization({ contractAddress, chainId }) {
    const a = await wallet.signAuthorization({ account, contractAddress, chainId });
    return { address: a.address, chainId: a.chainId, nonce: a.nonce, r: a.r, s: a.s, yParity: a.yParity ?? 0 };
  },
};

// 3. Sponsor a batch (e.g. an ERC-20 transfer) — gasless for the user.
const calls: Call[] = [{ to: TOKEN, value: 0n, data: transferCalldata }];
const tx = await sponsorExecute({
  client, signer,
  chainId: 11155111,
  signWith: process.env.KRYARD_SIGN_WITH!, // the relayer key
  delegateAddress: KRYARD_DELEGATE,        // deployed KryardDelegate on this chain
  calls,
  nonce: BigInt(Date.now()),               // single-use delegate nonce
});
console.log(tx.id, tx.txHash);

// Poll to completion:
let status = tx;
while (!["confirmed", "failed", "expired"].includes(status.status)) {
  await new Promise((r) => setTimeout(r, 4000));
  status = await client.get(tx.id);
}
```

## ERC-20 gas payment ("pay gas in any token")

Add `gasToken` + `gasTokenAmount` + `relayer` to `sponsorExecute`. The user signs an
exact fee (the relayer can't inflate it); the on-chain `KryardDelegate` transfers that
token amount to the relayer as the batch's last step:

```ts
await sponsorExecute({
  client, signer, chainId, signWith, delegateAddress, calls, nonce,
  gasToken: USDC,
  gasTokenAmount: 50_000n,   // Kryard quotes this off-chain (gas × price × rate × margin)
  relayer: RELAYER_ADDRESS,  // the address the relayer signs with on this chain
});
```

## Custom delegate (delegate-agnostic) — e.g. a sweep

If you use your OWN 7702 delegate (not `KryardDelegate`), build the calldata + any
inner delegate signature yourself, then use `sponsorCall` — the SDK signs only the
7702 authorization and submits, making no assumption about the delegate:

```ts
import { sponsorCall } from "@kryard/sdk";

// You build the call to your delegate (e.g. SweepDelegate.sweep(order, sweepSig)).
const sweepData = encodeFunctionData({ abi: SWEEP_DELEGATE_ABI, functionName: "sweep", args: [order, sweepSig] });

const tx = await sponsorCall({
  client, signer,                 // signer only needs { address, signAuthorization }
  chainId, signWith,
  delegateAddress: SWEEP_DELEGATE, // the 7702 target the user authorizes
  data: sweepData,                 // your pre-built calldata
  // optional ERC-20 accounting (if your call reimburses the relayer in token):
  // gasToken: USDC, gasTokenAmount: skimmedGasInToken,
});
```

`sponsorExecute` (above) is just `sponsorCall` with the KryardDelegate calldata built
for you.

## Wallets & signing

`KryardClient` wraps Kryard's Turnkey-compatible activity API. Every method stamps
the exact request body with your API key and parses the single-nested activity
envelope, throwing an `ActivityError` (carrying the server's `code` + `message`) when
an activity does not complete.

```ts
import { KryardClient, createApiKeyStamper, ActivityError } from "@kryard/sdk";

const kryard = new KryardClient({
  baseUrl: "https://api.kryard.com",
  organizationId: process.env.KRYARD_ORG!,
  stamper: createApiKeyStamper({
    apiPublicKey: process.env.KRYARD_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.KRYARD_API_PRIVATE_KEY!,
  }),
});

// Create a secp256k1 EVM key (defaults: CURVE_SECP256K1, ADDRESS_FORMAT_ETHEREUM).
const { privateKeyId, addresses } = await kryard.createPrivateKey({ name: "hot-wallet-1" });
// → addresses: [{ addressFormat: "ADDRESS_FORMAT_ETHEREUM", address: "0x…" }]

// Sign an EVM transaction (signedTransaction is hex WITHOUT 0x — ready to broadcast).
const { signedTransaction } = await kryard.signTransaction({
  signWith: privateKeyId,            // a key id OR an address the org owns
  unsignedTransaction: "0x02ef…",    // serialized EIP-1559 tx, e.g. from viem
});

// Sign a raw payload (r/s/v components).
const { r, s, v } = await kryard.signRawPayload({
  signWith: privateKeyId,
  payload: "0xdeadbeef",
  hashFunction: "HASH_FUNCTION_KECCAK256",
});

try {
  await kryard.signTransaction({ signWith: "0xUnknown", unsignedTransaction: "0x02ef…" });
} catch (e) {
  if (e instanceof ActivityError) console.error(e.code, e.message); // typed failure
}
```

You may also import any Turnkey-protocol stamper (e.g. `@turnkey/api-key-stamper`) —
Kryard speaks the Turnkey protocol — or inject your own `Stamper`.

### Against a local signer (open-source, no account)

The open-source signer ([`Kryard/signer`](https://github.com/Kryard/signer)) runs the
same API locally. In dev mode (`DEV_ADMIN_ENABLED=true`) it exposes an unauthenticated
bootstrap that mints a throwaway org + API key, so you don't need a managed account.
`bootstrapLocalClient` does that and hands back a ready client:

```ts
import { bootstrapLocalClient } from "@kryard/sdk";

const { client } = await bootstrapLocalClient(); // defaults to http://localhost:8787
const { addresses } = await client.createPrivateKey({ name: "local-evm", curve: "CURVE_SECP256K1" });
```

**Dev-only** — it targets `/admin/dev/*`, which the API exposes only in dev mode; never
point it at a public deployment. Creating keys and queries work out of the box; to also
*sign* locally, run the API with `POLICY_BYPASS_ALLOWED=true` (or seed a policy).

## Key export

Export pulls a key out as an **HPKE-sealed bundle** (RFC 9180, suite
`DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM`, info `"kryard-export-v1"`,
aad = the key id). The signer decrypts the key inside its boundary and re-seals it to
a recipient public key you supply — plaintext never crosses the wire.

```ts
// Convenience: generate an ephemeral recipient keypair, request the sealed bundle,
// HPKE-open it locally, and return the recovered key. The recipient key is zeroized.
const { privateKey } = await kryard.exportPrivateKey({ signWith: privateKeyId });
// privateKey: hex (no 0x) — handle like any raw key (do not log / persist / transmit).
```

Bring-your-own-recipient (e.g. an HSM or air-gapped key holds the recipient secret):

```ts
import { decryptExportBundle, generateRecipientKeyPair } from "@kryard/sdk";

const recipient = await generateRecipientKeyPair();           // P-256, SEC1-uncompressed hex
const { privateKeyId: resolvedId, exportBundle } = await kryard.exportPrivateKeyBundle({
  signWith: privateKeyId,
  targetPublicKey: recipient.publicKeyHex,
});
// Open with the recipient private key. The aad MUST be the resolved key id.
const keyBytes = await decryptExportBundle(exportBundle, recipient.privateKey, resolvedId);
```

The bundle is a clean RFC-9180 HPKE format and interops with the Go (CIRCL) signer;
it is **not** byte-compatible with Turnkey's enclave-wrapped `decryptExportBundle`.

## Lower-level building blocks

- `submitActivity(...)` — stamp + POST any activity, parse the envelope, throw on FAILED.
- `delegateDigest(...)` — the 32-byte digest the user personal-signs (mirrors the contract).
- `encodeExecute` / `encodeExecuteWithGasReimbursement` — KryardDelegate calldata.
- `buildSponsoredExecute(...)` — assemble a relay submit body from already-signed pieces (pure).
- `KryardRelayClient.submit` / `.get` — the raw relay route, X-Stamp authed.

## License

MIT.
