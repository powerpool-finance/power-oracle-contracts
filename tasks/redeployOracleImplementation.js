/* global usePlugin, task */

usePlugin('@nomiclabs/buidler-truffle5');

const fs = require('fs');
const pIteration = require('p-iteration');

task('redeploy-oracle-implementation', 'Redeploy oracle implementation')
  .setAction(async () => {
    const { keccak256 } = require('../test/helpers');
    const PowerOracle = artifacts.require('PowerOracle');
    PowerOracle.numberFormat = 'String';

    const proxyAddress = '0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB';
    const oracle = await PowerOracle.at(proxyAddress);
    const numTokens = await oracle.numTokens();
    console.log('numTokens', numTokens);
    const configs = [];
    for(let i = 0; i < numTokens; i++) {
      configs[i] = await oracle.getTokenConfig(i);
    }
    const addPairs = [
      {market: '0xce84867c3c02b05dc570d0135103d3fb9cc19433', token: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', symbol: keccak256('SUSHI')},
      {market: '0xddf9b7a31b32ebaf5c064c80900046c9e5b7c65f', token: '0x2ba592F78dB6436527729929AAf6c908497cB200', symbol: keccak256('CREAM')},
      {market: '0x8cb77ea869def8f7fdeab9e4da6cf02897bbf076', token: '0x8ab7404063ec4dbcfd4598215992dc3f8ec853d7', symbol: keccak256('AKRO')},
      {market: '0x465e22e30ce69ec81c2defa2c71d510875b31891', token: '0x5D8d9F5b96f4438195BE9b99eee6118Ed4304286', symbol: keccak256('COVER')},
      {market: '0x87febfb3ac5791034fd5ef1a615e9d9627c2665d', token: '0x1cEB5cB57C4D4E2b2433641b95Dd330A33185A44', symbol: keccak256('KP3R')},
      {market: '0xdc98556ce24f007a5ef6dc1ce96322d65832a819', token: '0x429881672B9AE42b8EbA0E26cD9C73711b891Ca5', symbol: keccak256('PICKLE')}
    ];
    await pIteration.forEachSeries(addPairs, (pair) => {
      configs.push({
        cToken: pair.token,
        underlying: pair.token,
        symbolHash: pair.symbol,
        baseUnit: '1000000000000000000',
        priceSource: '2',
        fixedPrice: '0',
        uniswapMarket: pair.market,
        isUniswapReversed: false
      })
    });
    console.log('configs', configs);

    const cvpToken = await oracle.cvpToken();
    const reservoir = await oracle.reservoir();
    const anchorPeriod = await oracle.anchorPeriod();
    console.log('cvpToken, reservoir, anchorPeriod', cvpToken, reservoir, anchorPeriod);
    fs.writeFileSync('./tmp/latestOracleDeployArguments.js', `module.exports = ${JSON.stringify(
      [cvpToken, reservoir, anchorPeriod, configs],
      null,
      2
    )}`);
    const newImpl = await PowerOracle.new(cvpToken, reservoir, anchorPeriod, configs);
    console.log('newImpl', newImpl.address);

    console.log('Done');
  });

module.exports = {};
