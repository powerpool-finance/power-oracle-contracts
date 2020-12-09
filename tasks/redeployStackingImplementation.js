/* global usePlugin, task */

usePlugin('@nomiclabs/buidler-truffle5');

const fs = require('fs');

task('redeploy-stacking-implementation', 'Redeploy stacking implementation')
  .setAction(async () => {
    const PowerOracleStaking = artifacts.require('PowerOracleStaking');
    PowerOracleStaking.numberFormat = 'String';

    const proxyAddress = '0xB10f9bB26EABB1f64E45eb0e0910f29efD32834C';
    const stacking = await PowerOracleStaking.at(proxyAddress);

    const cvpToken = await stacking.cvpToken();
    const reservoir = await stacking.reservoir();
    console.log('cvpToken, reservoir, anchorPeriod', cvpToken, reservoir);
    fs.writeFileSync('./tmp/latestOracleDeployArguments.js', `module.exports = ${JSON.stringify(
      [cvpToken, reservoir],
      null,
      2
    )}`);
    const newImpl = await PowerOracleStaking.new(cvpToken, reservoir);

    console.log('PowerOracleStaking newImpl', newImpl.address);

    console.log('Done');
  });

module.exports = {};
