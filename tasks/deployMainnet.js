/* global task */

const pIteration = require('p-iteration');
const _ = require('lodash');

require('@nomiclabs/hardhat-truffle5');

task('deploy-mainnet', 'Deploys mainnet contracts')
  .setAction(async (__, { ethers, network }) => {
    const { deployProxied, ether, address, keccak256, uint, gwei, impersonateAccount } = require('../test/helpers');
    const { constants } = require('@openzeppelin/test-helpers');

    const PowerPokeStaking = artifacts.require('PowerPokeStaking');
    const PowerOracle = artifacts.require('PowerOracle');
    const PowerPoke = artifacts.require('PowerPoke');

    PowerPokeStaking.numberFormat = 'String';
    PowerOracle.numberFormat = 'String';

    const { web3 } = PowerPokeStaking;
    const [deployer] = await web3.eth.getAccounts();

    const proxyAddress = '0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB';
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
    // In order to act as a slasher, a user should keep their deposit >= MIN_SLASHING_DEPOSIT
    const MIN_SLASHING_DEPOSIT = ether(40);
    // A slasher reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const SLASHER_REWARD_PCT = '0';//ether('0.015');
    // The protocol reward in pct to the reporter deposit. Is multiplied to the outdated token count.
    const RESERVOIR_REWARD_PCT = '0';//ether('0.005');
    // 1 ether == 1%
    const CVP_APY = ether(20);
    // count
    const TOTAL_REPORTS_PER_YEAR = '105120';
    // In gas
    const GAS_EXPENSES_PER_ASSET_REPORT = '85000';
    // In wei
    const GAS_PRICE_LIMIT = gwei(1000);

    const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
    const PROXY_OWNER = OWNER;
    const RESERVOIR = '0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E';

    console.log('Deployer address is', deployer);

    console.log('>>> Deploying PowerOracleStaking...');
    const staking = await deployProxied(
      PowerPokeStaking,
      [cvpAddress],
      [deployer, RESERVOIR, constants.ZERO_ADDRESS, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT, 60 * 5, 60 * 5],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracleStaking (proxy) deployed at', staking.address);
    console.log('>>> PowerOracleStaking implementation deployed at', staking.initialImplementation.address);

    const powerPoke = await deployProxied(
      PowerPoke,
      [cvpAddress, wethAddress, gasPriceOracle, uniswapRouterAddress, staking.address],
      [deployer, constants.ZERO_ADDRESS],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerPoke (proxy) deployed at', powerPoke.address);
    console.log('>>> PowerPoke implementation deployed at', powerPoke.initialImplementation.address);

    await staking.setSlasher(powerPoke.address);

    console.log('>>> Deploying PowerOracle...');
    const oracle = await deployProxied(
      PowerOracle,
      [cvpAddress, ANCHOR_PERIOD, configs],
      [OWNER, powerPoke.address],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracle (proxy) deployed at', oracle.address);
    console.log('>>> PowerOracle implementation deployed at', oracle.initialImplementation.address);

    console.log('>>> Setting powerOracle address in powerOracleStaking');
    await powerPoke.setOracle(oracle.address);

    await powerPoke.addClient(oracle.address, OWNER, false, gwei(1.5), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL);
    await powerPoke.setMinimalDeposit(oracle.address, MIN_SLASHING_DEPOSIT);
    await powerPoke.setBonusPlan(oracle.address, '1', true, '20', '10', '100000');
    await powerPoke.setBonusPlan(oracle.address, '2', true, '20', '10', '100000');

    console.log('>>> Transferring powerStaking address to the owner');
    await staking.transferOwnership(OWNER);
    await oracle.transferOwnership(OWNER);
    await powerPoke.transferOwnership(OWNER);
    await powerPoke.transferClientOwnership(oracle.address, OWNER);

    console.log('Done');

    if (network.name !== 'mainnetfork') {
      return;
    }
    const MockCVP = artifacts.require('MockCVP');
    const cvpToken = await MockCVP.at(cvpAddress);
    const fromOwner = {from: OWNER};
    await impersonateAccount(ethers, OWNER);

    await cvpToken.approve(powerPoke.address, ether(10000), fromOwner);
    await powerPoke.addCredit(oracle.address, ether(10000), fromOwner);

    await cvpToken.transfer(deployer, MIN_SLASHING_DEPOSIT, fromOwner);
    await cvpToken.approve(staking.address, MIN_SLASHING_DEPOSIT, {from: deployer});
    await staking.createUser(deployer, deployer, MIN_SLASHING_DEPOSIT, {from: deployer});

    await oracle.pokeFromReporter()
    console.log('>>> Making the initial poke');
    await oracle.poke(['ETH', 'YFI', 'COMP', 'CVP', 'SNX', 'wNXM', 'MKR', 'UNI', 'UMA', 'AAVE', 'DAI', 'SUSHI', 'CREAM', 'AKRO', 'KP3R', 'PICKLE', 'GRT', 'WHITE']);

  });

module.exports = {};
