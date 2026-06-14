export { KRYARD_DELEGATE_ABI } from "./abi.js";
export { createApiKeyStamper, type ApiKeyStamperOptions } from "./stamper.js";
export {
  delegateDigest,
  callsHash,
  encodeExecute,
  encodeExecuteWithGasReimbursement,
  type Call,
  type DelegateDigestInput,
} from "./digest.js";
export {
  KryardRelayClient,
  type Stamper,
  type FetchFn,
  type RelayAuthorization,
  type RelaySubmitInput,
  type RelayTx,
  type KryardRelayClientOpts,
} from "./client.js";
export {
  buildSponsoredCall,
  sponsorCall,
  buildSponsoredExecute,
  sponsorExecute,
  type SponsoredCallParams,
  type SponsorCallOptions,
  type SponsoredExecuteParams,
  type SponsorExecuteOptions,
  type UserSigner,
} from "./sponsor.js";
// --- Wallets & signing (Turnkey-compatible activity API) ------------------
export {
  submitActivity,
  ActivityError,
  type ActivityFailure,
  type ActivityEnvelope,
  type ActivityOutcome,
  type SubmitActivityOptions,
} from "./activity.js";
export {
  KryardClient,
  type KryardClientOpts,
  type CreatePrivateKeyInput,
  type CreatePrivateKeyResult,
  type AddressEntry,
  type SignRawPayloadInput,
  type SignRawPayloadResult,
  type SignTransactionInput,
  type SignTransactionResult,
  type ExportPrivateKeyBundleInput,
  type ExportPrivateKeyInput,
  type ExportedPrivateKey,
} from "./wallet.js";
// --- Key export (HPKE) ----------------------------------------------------
export {
  decryptExportBundle,
  generateRecipientKeyPair,
  zeroizeRecipient,
  exportSuite,
  EXPORT_INFO_LABEL,
  type ExportBundle,
  type RecipientKeyPair,
} from "./export.js";
// --- Local dev bootstrap (open-source signer; DEV ONLY) -------------------
export {
  bootstrapLocalClient,
  type BootstrapLocalClientOptions,
  type BootstrapLocalClientResult,
} from "./devBootstrap.js";
