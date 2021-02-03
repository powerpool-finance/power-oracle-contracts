const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { ether, gwei, deployProxied, address, getEventArg } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');
const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const PowerPokeStaking = artifacts.require('PowerPokeStaking');
const PowerOracle = artifacts.require('PowerOracle');
const PowerPoke = artifacts.require('PowerPoke');
const MockFastGasOracle = artifacts.require('MockFastGasOracle');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
PowerPokeStaking.numberFormat = 'String';
PowerOracle.numberFormat = 'String';

const ANCHOR_PERIOD = 30;
const MIN_REPORT_INTERVAL = 60;
const MAX_REPORT_INTERVAL = 90;
const SLASHER_REWARD_PCT = ether(15);
const RESERVOIR_REWARD_PCT = ether(5);
const GAS_PRICE_LIMIT = gwei(1000);
const WETH = address(111);
const DEPOSIT_TIMEOUT = '30';
const WITHDRAWAL_TIMEOUT = '180';

describe('IntegrationTest', function () {
  let staking;
  let oracle;
  let poke;
  let cvpToken;
  let powerPokeOpts;
  let fastGasOracle;

  let deployer, owner, reservoir, alice, bob, charlie, alicePoker, bobPoker, charlieReporter, sink, uniswapRouter, oracleClientOwner;

  before(async function() {
    [
      deployer,
      owner,
      reservoir,
      alice,
      bob,
      charlie,
      alicePoker,
      bobPoker,
      charlieReporter,
      sink,
      uniswapRouter,
      oracleClientOwner,
    ] = await web3.eth.getAccounts();
    fastGasOracle = await MockFastGasOracle.new(GAS_PRICE_LIMIT);
    powerPokeOpts = web3.eth.abi.encodeParameter(
      {
        PowerPokeRewardOpts: {
          to: 'address',
          rewardsInEth: 'bool'
        },
      },
      {
        to: alice,
        rewardsInEth: false
      },
    );
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(2e9));
  });

  it('should allow stake, poke and slash', async function() {
    staking = await deployProxied(
      PowerPokeStaking,
      [cvpToken.address, DEPOSIT_TIMEOUT, WITHDRAWAL_TIMEOUT],
      [owner, reservoir, constants.ZERO_ADDRESS, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT],
      { proxyAdminOwner: owner }
      );

    poke = await deployProxied(
      PowerPoke,
      [cvpToken.address, WETH, fastGasOracle.address, uniswapRouter, staking.address],
      [owner, sink],
      { proxyAdminOwner: owner }
    );

    oracle = await deployProxied(
      PowerOracle,
      [cvpToken.address, ANCHOR_PERIOD, await getTokenConfigs(cvpToken.address)],
      [owner, poke.address],
      { proxyAdminOwner: owner }
      );

    await poke.setOracle(oracle.address, { from: owner });
    await staking.setSlasher(poke.address, { from: owner });

    await poke.addClient(oracle.address, oracleClientOwner, true, gwei(300), MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, { from: owner });
    await cvpToken.transfer(alice, ether(100000), { from: deployer });
    await cvpToken.approve(poke.address, ether(30000), { from: alice })
    await poke.addCredit(oracle.address, ether(30000), { from: alice });
    await poke.setCompensationPlan(oracle.address, 1,  25, 17520000, 100 * 1000, { from: oracleClientOwner });

    expect(await staking.CVP_TOKEN()).to.be.equal(cvpToken.address);

    // Distribute funds...
    await cvpToken.transfer(reservoir, ether(100000), { from: deployer });
    await cvpToken.transfer(alice, ether(1000), { from: deployer });
    await cvpToken.transfer(bob, ether(1000), { from: deployer });
    await cvpToken.transfer(charlie, ether(1000), { from: deployer });

    // Approve funds...
    await cvpToken.approve(oracle.address, ether(100000), { from: reservoir });
    await cvpToken.approve(staking.address, ether(100), { from: alice });
    await cvpToken.approve(staking.address, ether(100), { from: bob });
    await cvpToken.approve(staking.address, ether(100), { from: charlie });

    // Register
    let res = await staking.createUser(alice, alicePoker, 0, { from: bob });
    const aliceId = getEventArg(res, 'CreateUser', 'userId');
    res = await staking.createUser(bob, bobPoker, 0, { from: alice });
    const bobId = getEventArg(res, 'CreateUser', 'userId');
    res = await staking.createUser(charlie, charlieReporter, 0, { from: charlie });
    const charlieId = getEventArg(res, 'CreateUser', 'userId');

    expect(aliceId).to.be.equal('1');
    expect(bobId).to.be.equal('2');
    expect(charlieId).to.be.equal('3');

    // Create Deposits
    await staking.createDeposit(charlieId, ether(30), { from: charlie });
    await staking.createDeposit(aliceId, ether(100), { from: alice });
    await staking.createDeposit(bobId, ether(50), { from: bob });

    expect(await staking.getDepositOf(aliceId)).to.be.equal(ether(0));
    expect(await staking.getDepositOf(bobId)).to.be.equal(ether(0));
    expect(await staking.getDepositOf(charlieId)).to.be.equal(ether(0));
    let alicePendingDeposit = await staking.getPendingDepositOf(aliceId);
    let bobPendingDeposit = await staking.getPendingDepositOf(bobId);
    let charliePendingDeposit = await staking.getPendingDepositOf(charlieId);
    expect(alicePendingDeposit.balance).to.be.equal(ether(100));
    expect(bobPendingDeposit.balance).to.be.equal(ether(50));
    expect(charliePendingDeposit.balance).to.be.equal(ether(30));

    await time.increase(DEPOSIT_TIMEOUT);

    // Execute Deposits
    await staking.executeDeposit(charlieId, { from: charlie });
    await staking.executeDeposit(aliceId, { from: alice });
    await staking.executeDeposit(bobId, { from: bob });

    expect(await staking.getDepositOf(aliceId)).to.be.equal(ether(100));
    expect(await staking.getDepositOf(bobId)).to.be.equal(ether(50));
    expect(await staking.getDepositOf(charlieId)).to.be.equal(ether(30));
    alicePendingDeposit = await staking.getPendingDepositOf(aliceId);
    bobPendingDeposit = await staking.getPendingDepositOf(bobId);
    charliePendingDeposit = await staking.getPendingDepositOf(charlieId);
    expect(alicePendingDeposit.balance).to.be.equal(ether(0));
    expect(bobPendingDeposit.balance).to.be.equal(ether(0));
    expect(charliePendingDeposit.balance).to.be.equal(ether(0));

    expect(await staking.getHDHID()).to.be.equal(aliceId);
    expect(await staking.getHighestDeposit()).to.be.equal(ether(100));

    // 1st Poke (Initial)
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP'], powerPokeOpts, { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '2',
      rewardCount: '2'
    })

    await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
      userId: '1',
    })

    await time.increase(40);

    // 2nd Poke
    await expect(oracle.pokeFromReporter(aliceId, ['DAI', 'REP'], powerPokeOpts, { from: alicePoker }))
      .to.be.revertedWith('NOTHING_UPDATED')

    await time.increase(65);

    // 3rd Poke
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP'], powerPokeOpts, { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '2',
      rewardCount: '2'
    })

    await expectEvent.inTransaction(res.tx, poke, 'RewardUser', {
      userId: '1',
      compensationPlan: '1',
    })

    // 4th Poke from Slasher which fails
    await expect(oracle.pokeFromSlasher(bobId, ['DAI', 'REP'], powerPokeOpts, { from: bobPoker }))
      .to.be.revertedWith('BELOW_HEARTBEAT_INTERVAL');

    await time.increase(95);

    // 5th Poke from Slasher which is successfull
    res = await oracle.pokeFromSlasher(bobId, ['DAI', 'REP'], powerPokeOpts, { from: bobPoker });
    expectEvent(res, 'PokeFromSlasher', {
      slasherId: '2',
      tokenCount: '2',
      overdueCount: '2'
    })
    expect(await staking.getDepositOf(aliceId)).to.be.equal(ether(60));

    // Withdrawing rewards
    await poke.withdrawRewards(aliceId, alice, { from: alice });
    await expect(poke.withdrawRewards(aliceId, alice, { from: alice }))
      .to.be.revertedWith('NOTHING_TO_WITHDRAW');

    // Withdraw stake
    await expect(staking.createWithdrawal(aliceId, ether(61), { from: alice }))
      .to.be.revertedWith('AMOUNT_EXCEEDS_DEPOSIT');
    await staking.createWithdrawal(aliceId, ether(60), { from: alice });
    await time.increase(WITHDRAWAL_TIMEOUT);
    await staking.executeWithdrawal(aliceId, alicePoker, { from: alice });

    expect(await cvpToken.balanceOf(alicePoker)).to.be.equal(ether(60));

    expect(await staking.getDepositOf(aliceId)).to.be.equal('0');
    expect(await staking.getDepositOf(bobId)).to.be.equal(ether(80));
    expect(await staking.getDepositOf(charlieId)).to.be.equal(ether(30));

    expect(await staking.getHDHID()).to.be.equal(bobId);
    expect(await staking.getHighestDeposit()).to.be.equal(ether(80));
  });
});
