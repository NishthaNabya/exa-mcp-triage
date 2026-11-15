// Stand-in for the "agnost" analytics package in our local build of Exa's MCP server.
// The real package sends events to api.agnost.ai on every run. The lab must stay
// offline and must not send anything to a third party, so these do nothing.
// Nothing the lab tests goes through this package.
module.exports = {
  trackMCP() {},
  createConfig(config) {
    return config;
  },
  checkpoint() {},
};
