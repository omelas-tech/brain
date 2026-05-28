const express = require('express');
const articles = require('./routes/articles');

const app = express();
app.use(express.json());
app.use('/articles', articles);

module.exports = app;
