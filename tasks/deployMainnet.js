/* global task */

const _ = require('lodash');

require('@nomiclabs/hardhat-truffle5');

task('deploy-mainnet', 'Deploys mainnet contracts')
  .setAction(async (__, { ethers, network }) => {
    const { deployProxied, ether, fromWei, gwei, impersonateAccount, ethUsed } = require('../test/helpers');
    const { constants, time } = require('@openzeppelin/test-helpers');

    const PowerPokeStaking = artifacts.require('PowerPokeStaking');
    const PowerOracle = artifacts.require('PowerOracle');
    const PowerPoke = artifacts.require('PowerPoke');

    PowerPokeStaking.numberFormat = 'String';
    PowerOracle.numberFormat = 'String';

    const { web3 } = PowerPokeStaking;
    const [deployer, testAcc] = await web3.eth.getAccounts();

    const proxyAddress = '0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB';
    const proxyAdminAddress = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
    const cvpAddress = '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1';
    const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const gasPriceOracle = '0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C';
    const uniswapRouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    const oldOracle = await PowerOracle.at(proxyAddress);
    const numTokens = await oldOracle.numTokens();
    console.log('numTokens', numTokens);
    let configs = [];
    for(let i = 0; i < numTokens; i++) {
      configs[i] = _.pick(await oldOracle.getTokenConfig(i), ['cToken', 'underlying', 'symbolHash', 'baseUnit', 'priceSource', 'fixedPrice', 'uniswapMarket', 'isUniswapReversed']);
    }

    const ANCHOR_PERIOD = 1800;
    // In seconds
    const MIN_REPORT_INTERVAL = 2700;
    // In seconds
    const MAX_REPORT_INTERVAL = 3600;
    const STAKE_CHANGE_INTERVAL = MAX_REPORT_INTERVAL;
    // In order to act as a slasher, a user should keep their deposit >= MIN_SLASHING_DEPOSIT
    const MIN_SLASHING_DEPOSIT = ether(5000);
    // A slasher reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const SLASHER_REWARD_PCT = '0';//ether('0.015');
    // The protocol reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const RESERVOIR_REWARD_PCT = '0';//ether('0.005');
    const BONUS_NUMERATOR = '7610350076';
    const BONUS_DENUMERATOR = '10000000000000000';
    // const BONUS_HEARTBEAT_NUMERATOR = '0';
    // const BONUS_HEARTBEAT_DENUMERATOR = '1800000000000000';
    const PER_GAS = '10000';
    const MAX_GAS_PRICE = gwei(500);

    const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
    const PROXY_OWNER = OWNER;
    const RESERVOIR = '0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E';

    console.log('Deployer address is', deployer);

    console.log('ETH before', web3.utils.fromWei(await web3.eth.getBalance(deployer)));
    // console.log('\n>>> Deploying PowerOracleStaking...');
    // const staking = await deployProxied(
    //   PowerPokeStaking,
    //   [cvpAddress],
    //   [deployer, RESERVOIR, constants.ZERO_ADDRESS, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT, STAKE_CHANGE_INTERVAL, STAKE_CHANGE_INTERVAL],
    //   {
    //     proxyAdminOwner: PROXY_OWNER,
    //     implementation: '0xc0cd319c0066733c611fb9a8bd5f2a1c38eb74b2',
    //     proxyAdmin: proxyAdminAddress
    //   }
    // );
    // console.log('>>> PowerOracleStaking (proxy) deployed at', staking.address);
    // console.log('>>> PowerOracleStaking implementation deployed at', staking.initialImplementation.address);
    const staking = await PowerPokeStaking.at('0x646e846b6ee143bde4f329d4165929bbdcf425f5');
    const powerPoke = await PowerPoke.at('0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96');
    const oracle = await PowerOracle.at('0x50f8D7f4db16AA926497993F020364f739EDb988');

    // console.log('\n>>> Deploying PowerPoke...');
    // const powerPoke = await deployProxied(
    //   PowerPoke,
    //   [cvpAddress, wethAddress, gasPriceOracle, uniswapRouterAddress, staking.address],
    //   [deployer, constants.ZERO_ADDRESS],
    //   {
    //     proxyAdminOwner: PROXY_OWNER,
    //     proxyAdmin: proxyAdminAddress,
    //     implementation: '0xfe53ad2c2085636febc20a9f06a0826659a5b059'
    //   }
    // );
    // console.log('>>> PowerPoke (proxy) deployed at', powerPoke.address);
    // console.log('>>> PowerPoke implementation deployed at', powerPoke.initialImplementation.address);
    //
    // // await staking.setSlasher(powerPoke.address);
    //
    // console.log('\n>>> Deploying PowerOracle...');
    // console.log('token configs', JSON.stringify(configs.map(c => [c.cToken, c.underlying, c.symbolHash, c.baseUnit, c.priceSource, c.fixedPrice, c.uniswapMarket, c.isUniswapReversed])));
    // const oracle = await deployProxied(
    //   PowerOracle,
    //   [cvpAddress, ANCHOR_PERIOD, configs],
    //   [OWNER, powerPoke.address],
    //   {
    //     proxyAdminOwner: PROXY_OWNER,
    //     proxyAdmin: proxyAdminAddress,
    //     implementation: '0xf0d67691da5ad3813aaf412756d61f0f4390c6d2'
    //   }
    // );
    // console.log('>>> PowerOracle (proxy) deployed at', oracle.address);
    // console.log('>>> PowerOracle implementation deployed at', oracle.initialImplementation.address);

    // console.log('>>> Setting powerOracle address in powerOracleStaking');
    // await powerPoke.setOracle(oracle.address);
    //
    // console.log('addClient');
    // await powerPoke.addClient(oracle.address, deployer, false, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL);
    // console.log('setMinimalDeposit');
    // await powerPoke.setMinimalDeposit(oracle.address, MIN_SLASHING_DEPOSIT);
    // console.log('setBonusPlan');
    // await powerPoke.setBonusPlan(oracle.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS);
    // // await powerPoke.setBonusPlan(oracle.address, '2', true, BONUS_HEARTBEAT_NUMERATOR, BONUS_HEARTBEAT_DENUMERATOR, PER_GAS);
    // console.log('setSlasherHeartbeat');
    // await powerPoke.setSlasherHeartbeat(oracle.address, MIN_REPORT_INTERVAL);
    // console.log('setFixedCompensations');
    // await powerPoke.setFixedCompensations(oracle.address, 260000, 99000);
    //
    // console.log('>>> Transferring powerStaking address to the owner');
    // await staking.transferOwnership(OWNER);
    // console.log('transferOwnership');
    // await powerPoke.transferOwnership(OWNER);
    // console.log('transferOwnership');
    // await powerPoke.transferClientOwnership(oracle.address, OWNER);
    console.log('ETH after', web3.utils.fromWei(await web3.eth.getBalance(deployer)));
    const symbolsToPoke = ['ETH', 'YFI', 'COMP', 'CVP', 'SNX', 'wNXM', 'MKR', 'UNI', 'UMA', 'AAVE', 'DAI', 'SUSHI', 'CREAM', 'AKRO', 'KP3R', 'PICKLE', 'GRT', 'WHITE'];
    // await oracle.poke(symbolsToPoke, {from: deployer});

    console.log('Done');

    if (network.name !== 'mainnetfork') {
      return;
    }
    const MockCVP = artifacts.require('MockCVP');
    const cvpToken = await MockCVP.at(cvpAddress);
    const fromOwner = {from: OWNER};
    await impersonateAccount(ethers, OWNER);

    const deposit = ether(10000000);
    const slasherDeposit = ether(199999.9);

    await web3.eth.sendTransaction({
      from: deployer,
      to: OWNER,
      value: ether(10),
    })

    await cvpToken.approve(powerPoke.address, ether(10000000), fromOwner);
    await powerPoke.addCredit(oracle.address, ether(10000000), fromOwner);

    await cvpToken.transfer(deployer, deposit, fromOwner);
    await cvpToken.approve(staking.address, deposit, {from: deployer});
    await staking.createUser(deployer, deployer, deposit, {from: deployer});

    // console.log('poke', symbolsToPoke);
    // await oracle.poke(symbolsToPoke, {from: deployer});

    await time.increase(MAX_REPORT_INTERVAL);

    await staking.executeDeposit('2',{from: deployer});
    let pokeCount = 0;

    await poke(deployer, 2);

    await time.increase(MIN_REPORT_INTERVAL);

    await poke(deployer, 2);

    await time.increase(MIN_REPORT_INTERVAL);

    await poke(deployer, 2);

    await time.increase(MIN_REPORT_INTERVAL);

    await poke(deployer, 2);

    await cvpToken.transfer(testAcc, slasherDeposit, fromOwner);
    await cvpToken.approve(staking.address, slasherDeposit, {from: testAcc});
    await staking.createUser(testAcc, testAcc, slasherDeposit, {from: testAcc});

    await time.increase(MAX_REPORT_INTERVAL);

    await staking.executeDeposit(3,{from: testAcc});
    //
    // await poke(testAcc, 2, 'pokeFromSlasher');
    //
    // await time.increase(MIN_REPORT_INTERVAL);

    const res = await oracle.slasherHeartbeat(3, {from: testAcc});
    console.log('\n\nslasherHeartbeat reward', fromWei(await powerPoke.rewards(2)));
    console.log('slasherHeartbeat gasUsed', res.receipt.gasUsed);

    async function poke(from, pokerId, pokeFunc = 'pokeFromReporter') {
      let {testAddress, testOpts} = await generateTestWalletAndCompensateOpts(web3, ethers, false);
      console.log('\n>>> Making the ' + pokeFunc);
      const pokeOptions = {from, gasPrice: gwei('100')};
      // console.log('getGasPriceFor', fromWei(await powerPoke.contract.methods.getGasPriceFor(oracle.address).call(pokeOptions), 'gwei'));

      let res = await oracle[pokeFunc](pokerId, symbolsToPoke,testOpts, pokeOptions)

      pokeCount++;
      const ethUsedByPoke = await ethUsed(web3, res.receipt);
      console.log('gasUsed', res.receipt.gasUsed);
      console.log('ethUsed', ethUsedByPoke);
      console.log('ethCompensated', fromWei(await web3.eth.getBalance(testAddress)));

      console.log('powerPoke rewards', fromWei(await powerPoke.rewards(pokerId)));
      await powerPoke.withdrawRewards(pokerId, from, {from});
      // console.log('cvpToken.balanceOf(from)', fromWei(await cvpToken.balanceOf(from)));

      console.log('cvp price', fromWei(await oracle.assetPrices(cvpAddress)));
    }
  });

async function generateTestWalletAndCompensateOpts(web3, ethers, compensateInETH = true) {
  const testWallet = ethers.Wallet.createRandom();
  const powerPokeOpts = web3.eth.abi.encodeParameter(
    {
      PowerPokeRewardOpts: {
        to: 'address',
        compensateInETH: 'bool'
      },
    },
    {
      to: testWallet.address,
      compensateInETH
    },
  );
  return {
    testAddress: testWallet.address,
    testOpts: powerPokeOpts
  }
}

module.exports = {};
