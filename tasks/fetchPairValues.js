/* global usePlugin, task */
const fs = require('fs');

usePlugin('@nomiclabs/buidler-truffle5');

task('dump-pairs', "Prints an account's balance")
  .setAction(async () => {
    const MockUniswapTokenPair = artifacts.require('MockUniswapTokenPair');
    MockUniswapTokenPair.numberFormat = 'String';

    const uniswapPairs = require('../config/uniswapPairs');
    const pairKeys = Object.keys(uniswapPairs.withPair);

    const result = {};
    for (const k of pairKeys) {
      console.log('>>> Fetching', k, '...');
      const pair = await MockUniswapTokenPair.at(uniswapPairs.withPair[k].pair);
      const res = await pair.getReserves();
      result[k] = {
        reserve0: res.reserve0,
        reserve1: res.reserve1,
        blockTimestampLast: res.blockTimestampLast,
      }
    }
    fs.writeFileSync('./tmp/pairValues.json', JSON.stringify(result, null, 2));
  });

module.exports = {};
