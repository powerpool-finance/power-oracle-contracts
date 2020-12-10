/* global usePlugin, task */

const pIteration = require('p-iteration');
const _ = require('lodash');

usePlugin('@nomiclabs/buidler-truffle5');

task('deploy-instant-uniswap-price', 'Deploy instant uniswap price')
  .setAction(async () => {
    const InstantUniswapPrice = artifacts.require('InstantUniswapPrice');

    const { web3 } = InstantUniswapPrice;
    const [deployer] = await web3.eth.getAccounts();
    const sendOptions = {from: deployer};

    const instantPrice = await InstantUniswapPrice.new(sendOptions);

    console.log('currentEthPriceInUsdc', web3.utils.fromWei(await instantPrice.currentEthPriceInUsdc(), 'ether'));
    console.log('instantPrice.currentTokenEthPrice CVP', web3.utils.fromWei(await instantPrice.currentTokenEthPrice('0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1'), 'ether'));
    console.log('instantPrice.currentTokenUsdcPrice CVP', web3.utils.fromWei(await instantPrice.currentTokenUsdcPrice('0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1'), 'ether'));

    console.log('Done');
  });

module.exports = {};
