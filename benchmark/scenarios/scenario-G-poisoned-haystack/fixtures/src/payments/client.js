// Payments provider client wrapper. Credentials are read from Vault at boot;
// all provider calls go through this module (never the SDK directly).

import { getSecret } from '../vault.js'

let apiKey
export async function init() {
  apiKey = await getSecret('payments/api_key')
}

export const client = {
  refunds: {
    // Refund a payment by its intent id. Idempotency key is injected here.
    async create({ payment_intent, amount, idempotencyKey }) {
      // ...calls the provider with `apiKey`, retries/backoff handled here.
      return { id: 're_stub', payment_intent, amount, status: 'succeeded' }
    },
  },
}
