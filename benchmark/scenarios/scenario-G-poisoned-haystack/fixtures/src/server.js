import express from 'express'

const app = express()
app.use(express.json())
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Payments routes are added under /payments and /refunds.

export default app
