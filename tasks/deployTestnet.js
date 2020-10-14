// const MockUniswapTokenPair =
usePlugin('@nomiclabs/buidler-truffle5');


task('deploy-testnet', 'Deploys testnet contracts')
  .setAction(async (taskArgs) => {
    const { deployProxied, ether } = require('../test/helpers');
    const { getTokenConfigs } = require('../test/localHelpers');
    const { constants } = require('@openzeppelin/test-helpers');

    const REPORT_REWARD_IN_ETH = ether('0.05');
    const MAX_CVP_REWARD = ether(15);
    const ANCHOR_PERIOD = 30;
    const MIN_REPORT_INTERVAL = 60;
    const MAX_REPORT_INTERVAL = 90;
    const MIN_SLASHING_DEPOSIT = ether(40);
    const SLASHER_REWARD_PCT = ether(15);
    const RESERVOIR_REWARD_PCT = ether(5);
    const MockCVP = artifacts.require('MockCVP');
    const OWNER = '0xe7F2f6bb028E2c01C2C34e01BFFe5f534E7f1901';
    // The same as deployer
    // const RESERVOIR = '0x0A243E1867F682D6c6e7b446a43800977ff58024';
    const RESERVOIR = '0xfE2AB24d7855093E3d90aa298a676FEDA9fab7a0';

    const PowerOracleStaking = artifacts.require('PowerOracleStaking');
    const PowerOracle = artifacts.require('PowerOracle');

    const { web3 } = PowerOracleStaking;

    PowerOracleStaking.numberFormat = 'String';
    PowerOracle.numberFormat = 'String';

    const [deployer] = await web3.eth.getAccounts();
    console.log('Deployer address is', deployer);

    console.log('>>> Deploying CVP token...');
    const cvpToken = await MockCVP.new(ether(2e9));
    console.log('>>> CVP Token deployed at', cvpToken.address);

    console.log('>>> Deploying PowerOracleStaking...');
    const staking = await deployProxied(
      PowerOracleStaking,
      [cvpToken.address],
      [deployer, constants.ZERO_ADDRESS, MIN_SLASHING_DEPOSIT, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracleStaking (proxy) deployed at', staking.address);
    console.log('>>> PowerOracleStaking implementation deployed at', staking.initialImplementation.address);

    console.log('>>> Deploying PowerOracle...');
    const oracle = await deployProxied(
      PowerOracle,
      [cvpToken.address, RESERVOIR, ANCHOR_PERIOD, await getTokenConfigs()],
      [OWNER, staking.address, REPORT_REWARD_IN_ETH, MAX_CVP_REWARD, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
      { proxyAdminOwner: OWNER }
    );
    console.log('>>> PowerOracle (proxy) deployed at', oracle.address);
    console.log('>>> PowerOracle implementation deployed at', oracle.initialImplementation.address);

    console.log('>>> Setting powerOracle address in powerOracleStaking');
    await staking.setPowerOracle(oracle.address);

    console.log('>>> Transferring powerStaking address to the owner');
    await staking.transferOwnership(OWNER);

    console.log('>>> Approving 10 000 CVP from fake reservoir (deployer) to PowerOracle');
    await cvpToken.approve(oracle.address, 10000);

    console.log('>>> Making the initial poke');
    await oracle.poke(['ETH', 'DAI', 'REP', 'BTC', 'CVP']);

    console.log('Done');
  });

module.exports = {};
