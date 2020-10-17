const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { K, ether, deployProxied, getEventArg, keccak256 } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');
const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const PowerOracleStaking = artifacts.require('PowerOracleStaking');
const PowerOracle = artifacts.require('PowerOracle');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
PowerOracleStaking.numberFormat = 'String';
PowerOracle.numberFormat = 'String';

const REPORT_REWARD_IN_ETH = ether('0.05');
const MAX_CVP_REWARD = ether(15);
const ANCHOR_PERIOD = 30;
const MIN_REPORT_INTERVAL = 60;
const MAX_REPORT_INTERVAL = 90;
const MIN_SLASHING_DEPOSIT = ether(40);
const SLASHER_REWARD_PCT = ether(15);
const RESERVOIR_REWARD_PCT = ether(5);
const SET_USER_REWARD_COUNT = 3;

describe('IntegrationTest', function () {
  let staking;
  let oracle;
  let cvpToken;

  let deployer, owner, timelockStub, reservoir, sourceStub1, sourceStub2, powerOracle, alice, bob, charlie, alicePoker, bobPoker, charlieReporter;

  before(async function() {
    [deployer, owner, timelockStub, reservoir, sourceStub1, sourceStub2, powerOracle, alice, bob, charlie, alicePoker, bobPoker, charlieReporter] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(2e9));
  });

  it('should allow stake, poke and slash', async function() {
    staking = await deployProxied(
      PowerOracleStaking,
      [cvpToken.address, reservoir],
      [owner, constants.ZERO_ADDRESS, MIN_SLASHING_DEPOSIT, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT, SET_USER_REWARD_COUNT],
      { proxyAdminOwner: owner }
      );

    oracle = await deployProxied(
      PowerOracle,
      [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs()],
      [owner, staking.address, REPORT_REWARD_IN_ETH, MAX_CVP_REWARD, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
      { proxyAdminOwner: owner }
      );

    await staking.setPowerOracle(oracle.address, { from: owner });

    expect(await staking.cvpToken()).to.be.equal(cvpToken.address);

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

    // Deposit
    await staking.deposit(charlieId, ether(30), { from: charlie });
    await staking.deposit(aliceId, ether(100), { from: alice });
    await staking.deposit(bobId, ether(50), { from: bob });

    expect(await staking.getDepositOf(aliceId)).to.be.equal(ether(100));
    expect(await staking.getDepositOf(bobId)).to.be.equal(ether(50));
    expect(await staking.getDepositOf(charlieId)).to.be.equal(ether(30));

    expect(await staking.getReporterId()).to.be.equal(aliceId);
    expect(await staking.getHighestDeposit()).to.be.equal(ether(100));

    // 1st Poke (Initial)
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP', 'CVP'], { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '3',
      rewardCount: '2'
    })

    expectEvent(res, 'RewardUser', {
      userId: '1',
      count: '2',
    })

    await time.increase(40);

    // 2nd Poke
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP', 'CVP'], { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '3',
      rewardCount: '0'
    })

    expectEvent(res, 'NothingToReward', {
      userId: '1',
    })

    await time.increase(65);

    // 3rd Poke
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP', 'CVP'], { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '3',
      rewardCount: '2'
    })

    expectEvent(res, 'RewardUser', {
      userId: '1',
      count: '2',
    })

    // 4th Poke from Slasher which fails
    res = await oracle.pokeFromSlasher(bobId, ['DAI', 'REP', 'CVP'], { from: bobPoker });
    expectEvent(res, 'PokeFromSlasher', {
      slasherId: '2',
      tokenCount: '3',
      overdueCount: '0'
    })

    await time.increase(95);

    // 5th Poke from Slasher which is successfull
    res = await oracle.pokeFromSlasher(bobId, ['DAI', 'REP', 'CVP'], { from: bobPoker });
    expectEvent(res, 'PokeFromSlasher', {
      slasherId: '2',
      tokenCount: '3',
      overdueCount: '3'
    })
    expect(await staking.getDepositOf(aliceId)).to.be.equal(ether(40));

    // Withdrawing rewards
    await oracle.withdrawRewards(aliceId, alice, { from: alice });
    await expect(oracle.withdrawRewards(aliceId, alice, { from: alice }))
      .to.be.revertedWith('PowerOracle::withdrawRewards: Nothing to withdraw');

    // Withdraw stake
    await expect(staking.withdraw(aliceId, alice, ether(41), { from: alice }))
      .to.be.revertedWith('PowerOracleStaking::withdraw: Amount exceeds deposit');
    await staking.withdraw(aliceId, alicePoker, ether(40), { from: alice });
    expect(await cvpToken.balanceOf(alicePoker)).to.be.equal(ether(40));

    expect(await staking.getDepositOf(aliceId)).to.be.equal('0');
    expect(await staking.getDepositOf(bobId)).to.be.equal(ether(95));
    expect(await staking.getDepositOf(charlieId)).to.be.equal(ether(30));


    expect(await staking.getReporterId()).to.be.equal(bobId);
    expect(await staking.getHighestDeposit()).to.be.equal(ether(95));
  });
});
