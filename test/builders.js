const { fixed } = require('./helpers');

const MockUniswapTokenPair = artifacts.require('MockUniswapTokenPair');

async function buildPair() {
  return await MockUniswapTokenPair.new(
    fixed(1.8e12),
    fixed(8.2e21),
    fixed(1.6e9),
    fixed(1.19e50),
    fixed(5.8e30)
  );
}

module.exports = {
  buildPair,
};
