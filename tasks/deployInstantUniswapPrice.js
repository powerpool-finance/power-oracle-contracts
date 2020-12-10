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
    console.log('instantPrice.currentTokenEthPrice WBTC', web3.utils.fromWei(await instantPrice.currentTokenEthPrice('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'), 'ether'));
    console.log('instantPrice.currentTokenUsdcPrice WBTC', web3.utils.fromWei(await instantPrice.currentTokenUsdcPrice('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'), 'ether'));

    console.log('instantPrice.balancerPoolEthTokensSum PIPT', web3.utils.fromWei(await instantPrice.balancerPoolEthTokensSum('0x26607ac599266b21d13c7acf7942c7701a8b699c'), 'ether'));
    console.log('instantPrice.balancerPoolUsdTokensSum PIPT', web3.utils.fromWei(await instantPrice.balancerPoolUsdTokensSum('0x26607ac599266b21d13c7acf7942c7701a8b699c'), 'ether'));
    console.log('instantPrice.balancerPoolEthTokensSum YETI', web3.utils.fromWei(await instantPrice.balancerPoolEthTokensSum('0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d'), 'ether'));
    console.log('instantPrice.balancerPoolUsdTokensSum YETI', web3.utils.fromWei(await instantPrice.balancerPoolUsdTokensSum('0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d'), 'ether'));

    console.log('instantPrice.balancerPoolUsdTokensSum BTC-WETH', web3.utils.fromWei(await instantPrice.balancerPoolUsdTokensSum('0x1eff8af5d577060ba4ac8a29a13525bb0ee2a3d5'), 'ether'));
    console.log('instantPrice.amountToEther BTC', web3.utils.fromWei(await instantPrice.amountToEther('302627813983', '8'), 'ether'));
    console.log('instantPrice.ethTokensSum BTC', web3.utils.fromWei(await instantPrice.ethTokensSum(['0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'], ['302627813983']), 'ether'));
    console.log('instantPrice.usdcTokensSum BTC', web3.utils.fromWei(await instantPrice.usdcTokensSum(['0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'], ['302627813983']), 'ether'));

    console.log('Done');
  });

module.exports = {};
