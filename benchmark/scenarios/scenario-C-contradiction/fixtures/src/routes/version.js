// Reference: this file is intentionally style-neutral so the fixture-only arm
// cannot infer the project's indentation convention from the existing code.
const express = require('express');
const router = express.Router();
router.get('/version', (req, res) => res.json({ version: process.env.npm_package_version || '0.0.1' }));
module.exports = router;
