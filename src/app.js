const express = require('express');

const app = express();

app.get('/', (_req, res) => {
  res.status(200).type('html').send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Challenge Finalizado</title>
      </head>
      <body>
        <main>
          <h1>Challenge finalizado</h1>
          <p>CI/CD, deploy y analisis de incidentes implementados.</p>
        </main>
      </body>
    </html>
  `);
});

app.get('/health', (_req, res) => {
  const envReady = Boolean(process.env.APP_ENV);
  if (!envReady) {
    return res.status(500).json({
      status: 'degraded',
      reason: 'APP_ENV is missing'
    });
  }

  return res.status(200).json({
    status: 'ok',
    env: process.env.APP_ENV
  });
});

module.exports = app;
