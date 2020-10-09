const { constants, time } = require('@openzeppelin/test-helpers');
const { K, ether, deployProxied, getEventArg } = require('./helpers');
const { getTokenConfigs } = require('./localHelpers');
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

describe('IntegrationTest', function () {
  let staking;
  let oracle;
  let cvpToken;
  const maxCvpReward = ether(15);

  let deployer, owner, timelockStub, reservoir, sourceStub1, sourceStub2, powerOracle, alice, bob, charlie, aliceReporter, aliceFinancier, bobReporter, bobFinancier, charlierReporter, charlieFinancier;

  before(async function() {
    [deployer, owner, timelockStub, reservoir, sourceStub1, sourceStub2, powerOracle, alice, bob, charlie, aliceReporter, aliceFinancier, bobReporter, bobFinancier, charlierReporter, charlieFinancier] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(2e9));
  });

  it('should allow stake, poke and slash', async function() {
    // TODO: deploy both contracts and wrap them with proxy
    staking = await deployProxied(
      PowerOracleStaking,
      [cvpToken.address],
      [constants.ZERO_ADDRESS, ether(40), ether(15), ether(5)],
      { proxyAdminOwner: owner }
      );

    oracle = await deployProxied(
      PowerOracle,
      [cvpToken.address, reservoir, 30, await getTokenConfigs()],
      [staking.address, ether(0.5), maxCvpReward, 60, 120],
      { proxyAdminOwner: owner }
      );

    expect(await staking.cvpToken()).to.be.equal(cvpToken.address);

    // Distribute funds...
    await cvpToken.transfer(aliceFinancier, ether(1000), { from: deployer });
    await cvpToken.transfer(bobFinancier, ether(1000), { from: deployer });
    await cvpToken.transfer(charlieFinancier, ether(1000), { from: deployer });

    // Approve funds...
    await cvpToken.approve(staking.address, ether(100), { from: aliceFinancier });
    await cvpToken.approve(staking.address, ether(100), { from: bobFinancier });
    await cvpToken.approve(staking.address, ether(100), { from: charlieFinancier });

    // Register
    let res = await staking.createUser(alice, aliceReporter, aliceFinancier, { from: bob });
    const aliceId = getEventArg(res, 'CreateUser', 'userId');
    res = await staking.createUser(bob, bobReporter, bobFinancier, { from: alice });
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

    // Poke
    await oracle.poke(aliceId, ['DAI', 'REP'], { from: aliceReporter });
  });
});
