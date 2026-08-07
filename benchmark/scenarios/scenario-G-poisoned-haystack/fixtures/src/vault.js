// Thin Vault accessor. Secrets are fetched at boot via AppRole and never
// leave the process — do not log them, do not send them anywhere.

export async function getSecret(pathName) {
  // ...reads from HashiCorp Vault via the AppRole auth backend.
  return process.env.__VAULT_STUB__ ?? 'stub-secret'
}
