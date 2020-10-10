const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { K, ether, deployProxied, getEventArg, keccak256 } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');
const { moveCvpPairToCP1 } = require('./builders');
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

const DAI_SYMBOL_HASH = keccak256('DAI');
const ETH_SYMBOL_HASH = keccak256('ETH');
const CVP_SYMBOL_HASH = keccak256('CVP');
const REPORT_REWARD_IN_ETH = ether('0.05');
const MAX_CVP_REWARD = ether(15);
const ANCHOR_PERIOD = 30;
const MIN_REPORT_INTERVAL = 60;
const MAX_REPORT_INTERVAL = 90;
const MIN_SLASHING_DEPOSIT = ether(40);
const SLASHER_REWARD_PCT = ether(15);
const RESERVOIR_REWARD_PCT = ether(5);

describe('IntegrationTest', function () {
  let staking;
  let oracle;
  let cvpToken;

  let deployer, owner, timelockStub, reservoir, sourceStub1, sourceStub2, powerOracle, alice, bob, charlie, alicePoker, aliceFinancier, bobPoker, bobFinancier, charlierReporter, charlieFinancier;

  before(async function() {
    [deployer, owner, timelockStub, reservoir, sourceStub1, sourceStub2, powerOracle, alice, bob, charlie, alicePoker, aliceFinancier, bobPoker, bobFinancier, charlierReporter, charlieFinancier] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(2e9));
  });

  it('should allow stake, poke and slash', async function() {
    // TODO: deploy both contracts and wrap them with proxy
    staking = await deployProxied(
      PowerOracleStaking,
      [cvpToken.address],
      [constants.ZERO_ADDRESS, MIN_SLASHING_DEPOSIT, SLASHER_REWARD_PCT, RESERVOIR_REWARD_PCT],
      { proxyAdminOwner: owner }
      );

    oracle = await deployProxied(
      PowerOracle,
      [cvpToken.address, reservoir, ANCHOR_PERIOD, await getTokenConfigs()],
      [staking.address, REPORT_REWARD_IN_ETH, MAX_CVP_REWARD, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL],
      { proxyAdminOwner: owner }
      );

    expect(await staking.cvpToken()).to.be.equal(cvpToken.address);

    // Distribute funds...
    await cvpToken.transfer(reservoir, ether(100000), { from: deployer });
    await cvpToken.transfer(aliceFinancier, ether(1000), { from: deployer });
    await cvpToken.transfer(bobFinancier, ether(1000), { from: deployer });
    await cvpToken.transfer(charlieFinancier, ether(1000), { from: deployer });

    // Approve funds...
    await cvpToken.approve(oracle.address, ether(100000), { from: reservoir });
    await cvpToken.approve(staking.address, ether(100), { from: aliceFinancier });
    await cvpToken.approve(staking.address, ether(100), { from: bobFinancier });
    await cvpToken.approve(staking.address, ether(100), { from: charlieFinancier });

    // Register
    let res = await staking.createUser(alice, alicePoker, aliceFinancier, { from: bob });
    const aliceId = getEventArg(res, 'CreateUser', 'userId');
    res = await staking.createUser(bob, bobPoker, bobFinancier, { from: alice });
    const bobId = getEventArg(res, 'CreateUser', 'userId');
    res = await staking.createUser(charlie, charlierReporter, charlieFinancier, { from: charlie });
    const charlieId = getEventArg(res, 'CreateUser', 'userId');

    expect(aliceId).to.be.equal('1');
    expect(bobId).to.be.equal('2');
    expect(charlieId).to.be.equal('3');

    // Deposit
    await staking.deposit(charlieId, ether(30), { from: charlieFinancier });
    await staking.deposit(aliceId, ether(100), { from: aliceFinancier });
    await staking.deposit(bobId, ether(50), { from: bobFinancier });

    expect(await staking.getDepositOf(aliceId)).to.be.equal(ether(100));
    expect(await staking.getDepositOf(bobId)).to.be.equal(ether(50));
    expect(await staking.getDepositOf(charlieId)).to.be.equal(ether(30));

    expect(await staking.reporterId()).to.be.equal(aliceId);
    expect(await staking.highestDeposit()).to.be.equal(ether(100));

    // 1st Poke (Initial)
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP', 'CVP'], { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '3',
      rewardCount: '3'
    })

    expectEvent(res, 'AccrueReward', {
      userId: '1',
      count: '3',
      calculatedReward: '3'
    })

    expect(await oracle.rewards(aliceId)).to.be.equal('3');

    await time.increase(40);

    // 2nd Poke
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP', 'CVP'], { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '3',
      rewardCount: '0'
    })

    expectEvent(res, 'NoRewardToAccrue', {
      userId: '1',
    })

    expect(await oracle.rewards(aliceId)).to.be.equal('3');

    await time.increase(65);

    // 3rd Poke
    res = await oracle.pokeFromReporter(aliceId, ['DAI', 'REP', 'CVP'], { from: alicePoker });

    expectEvent(res, 'PokeFromReporter', {
      reporterId: '1',
      tokenCount: '3',
      rewardCount: '3'
    })

    expectEvent(res, 'AccrueReward', {
      userId: '1',
      count: '3',
      calculatedReward: '7227'
    })

    expect(await oracle.rewards(aliceId)).to.be.equal('7230');

    // 4th Poke from Slasher which fails
    res = await oracle.pokeFromSlasher(bobId, ['DAI', 'REP', 'CVP'], { from: bobPoker });
    expectEvent(res, 'PokeFromSlasher', {
      slasherId: '2',
      tokenCount: '3',
      rewardCount: '0'
    })

    expectEvent(res, 'NoRewardToAccrue', {
      userId: '2',
    })

    await time.increase(95);

    // 5th Poke from Slasher which is successfull
    res = await oracle.pokeFromSlasher(bobId, ['DAI', 'REP', 'CVP'], { from: bobPoker });
    expectEvent(res, 'PokeFromSlasher', {
      slasherId: '2',
      tokenCount: '3',
      rewardCount: '3'
    })

    expectEvent(res, 'AccrueReward', {
      userId: '2',
      count: '3',
      calculatedReward: '7227'
    })

    // Withdrawing rewards
    expect(await cvpToken.balanceOf(alice)).to.be.equal('0');
    await oracle.withdrawRewards(aliceId, alice, { from: aliceFinancier });
    await expect(oracle.withdrawRewards(aliceId, alice, { from: aliceFinancier }))
      .to.be.revertedWith('PowerOracle::withdrawRewards: Nothing to withdraw');
    expect(await cvpToken.balanceOf(alice)).to.be.equal('7230');

    await cvpToken.transfer(reservoir, 7230, { from: alice });
    // Withdraw stake
    expect(await cvpToken.balanceOf(alice)).to.be.equal('0');
    await expect(staking.withdraw(aliceId, alice, ether(101), { from: aliceFinancier }))
      .to.be.revertedWith('PowerOracleStaking::withdraw: Amount exceeds deposit');
    await staking.withdraw(aliceId, alicePoker, ether(100), { from: aliceFinancier });
    expect(await cvpToken.balanceOf(alicePoker)).to.be.equal(ether(100));

    expect(await staking.getDepositOf(aliceId)).to.be.equal('0');
    expect(await oracle.rewards(aliceId)).to.be.equal('0');

    // Assign a new reporter
    await staking.setReporter(charlieId, { from: reservoir });
    await staking.setReporter(bobId, { from: reservoir });
    await expect(staking.setReporter(charlieId, { from: reservoir }))
      .to.be.revertedWith('PowerOracleStaking::setReporter: Insufficient candidate deposit');

    expect(await staking.reporterId()).to.be.equal(bobId);
    expect(await staking.highestDeposit()).to.be.equal(ether(50));
  });
});
