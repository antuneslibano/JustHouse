const serverless = require('serverless-http');

// Adapta o app Express para uma Netlify Function. As chamadas chegam por
// /api/* (redirect do netlify.toml) ou direto em /.netlify/functions/api/*.
function createHandler(app) {
  return serverless(app, {
    request(req) {
      req.url = req.url.replace(/^\/\.netlify\/functions\/api(?=\/|\?|$)/, '/api');
    },
  });
}

module.exports = { createHandler };
