// Vercel entry point. All the logic lives in senso-mcp.js, which exports a request handler
// when it is imported rather than executed, so the deployed server and the local one are the
// same file with the same behaviour.
module.exports = require('../senso-mcp.js');
