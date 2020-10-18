const { fixed } = require('./helpers');

const MockUniswapTokenPair = artifacts.require('MockUniswapTokenPair');

async function buildPair() {
  return await MockUniswapTokenPair.new(
    fixed(1.8e12),
    fixed(8.2e18),
    fixed(1.6e9),
    fixed(1.19e50),
    fixed(5.8e30)
  );
}

/**
 * Build Uniswap CVP pair
 * @param {string} timestamp
 * @returns {Promise<any>}
 */
async function buildCvpPair(timestamp) {
  return MockUniswapTokenPair.new(
    // reserve0_
    '447524245108904579507942',
    // reserve1_
    '2375909307458759621213',
    // blockTimestampLast_
    // '1602266545',
    timestamp,
    // price0CumulativeLast_
    '203775841804087426407614127214505850328',
    // price1CumulativeLast_
    '2252004857118134099488260334514310055795531'
  );
}

/**
 * Build Uniswap CVP pair
 * @param {string} timestamp
 * @returns {Promise<any>}
 */
async function buildUsdcEth(timestamp) {
  return MockUniswapTokenPair.new(
    // reserve0_
    '266500031330401',
    // reserve1_
    '731038125338232251226332',
    // blockTimestampLast_
    // '1602277749',
    timestamp,
    // price0CumulativeLast_
    '253482859812666220342361026802903530871862032089570',
    // price1CumulativeLast_
    '21065123404263661723452955314367'
  );
}

module.exports = {
  buildPair,
  buildCvpPair,
  buildUsdcEth
};
