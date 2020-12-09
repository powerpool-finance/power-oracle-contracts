/* global usePlugin, task */

usePlugin('@nomiclabs/buidler-truffle5');

const fs = require('fs');

task('redeploy-oracle-implementation', 'Redeploy oracle implementation')
  .setAction(async () => {
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
