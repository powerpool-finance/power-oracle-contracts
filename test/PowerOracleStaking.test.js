const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { K, ether, deployProxied } = require('./helpers');

const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockStaking = artifacts.require('MockStaking');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
MockStaking.numberFormat = 'String';

const MINIMAL_SLASHING_DEPOSIT = ether(50);
const SLASHER_REWARD_PCT = ether(15);
const RESERVOIR_SLASHING_REWARD_PCT = ether(5);

describe('PowerOracleStaking', function () {
  let staking;
  let cvpToken;

  let deployer, owner, timelockStub, sourceStub1, sourceStub2, powerOracle, alice, bob, alicePoker, aliceFinancier, bobPoker, bobFinancier;

  before(async function() {
    [deployer, owner, timelockStub, sourceStub1, sourceStub2, powerOracle, alice, bob, alicePoker, aliceFinancier, bobPoker, bobFinancier] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(2000));
    staking = await deployProxied(
      MockStaking,
      [cvpToken.address],
      [owner, powerOracle, MINIMAL_SLASHING_DEPOSIT, SLASHER_REWARD_PCT, RESERVOIR_SLASHING_REWARD_PCT],
      { proxyAdminOwner: owner }
    );
  });

  describe('initialization', () => {
    it('should initialize correctly', async function() {
      expect(await staking.cvpToken()).to.be.equal(cvpToken.address);
      expect(await staking.owner()).to.be.equal(owner);
      expect(await staking.powerOracle()).to.be.equal(powerOracle);
      expect(await staking.minimalSlashingDeposit()).to.be.equal(MINIMAL_SLASHING_DEPOSIT);
      expect(await staking.slasherRewardPct()).to.be.equal(SLASHER_REWARD_PCT);
      expect(await staking.reservoirSlashingRewardPct()).to.be.equal(RESERVOIR_SLASHING_REWARD_PCT);
    });
  })

  describe('user interface', () => {
    describe('createUser', () => {
      it('should allow to create a user without initial deposit', async function() {
        const res = await staking.createUser(alice, alicePoker, aliceFinancier, 0, { from: bob });
        expectEvent(res, 'CreateUser', {
          userId: '1',
          adminKey: alice,
          pokerKey: alicePoker,
          financierKey: aliceFinancier,
          initialDeposit: '0'
        })
        const user = await staking.users(1);
        expect(user.adminKey).to.equal(alice);
        expect(user.pokerKey).to.equal(alicePoker);
        expect(user.financierKey).to.equal(aliceFinancier);
        expect(user.deposit).to.equal('0');
      });

      it('should allow to create a user without initial deposit', async function() {
        await cvpToken.transfer(bob, ether(1000), { from: deployer });
        await cvpToken.approve(staking.address, ether(30), { from: bob });

        const res = await staking.createUser(alice, alicePoker, aliceFinancier, ether(30), { from: bob });
        expectEvent(res, 'CreateUser', {
          userId: '1',
          adminKey: alice,
          pokerKey: alicePoker,
          financierKey: aliceFinancier,
          initialDeposit: ether(30)
        })
        expectEvent(res, 'Deposit', {
          userId: '1',
          depositor: bob,
          amount: ether(30),
          depositAfter: ether(30)
        })

        const user = await staking.users(1);
        expect(user.adminKey).to.equal(alice);
        expect(user.pokerKey).to.equal(alicePoker);
        expect(user.financierKey).to.equal(aliceFinancier);
        expect(user.deposit).to.equal(ether(30));
      });

      it('should correctly update id counter', async function() {
        let res = await staking.createUser(alice, alicePoker, aliceFinancier, 0, { from: bob });
        expectEvent(res, 'CreateUser', { userId: '1' });
        res = await staking.createUser(alice, alicePoker, aliceFinancier, 0, { from: bob });
        expectEvent(res, 'CreateUser', { userId: '2' });
        res = await staking.createUser(alice, alicePoker, aliceFinancier, 0, { from: bob });
        expectEvent(res, 'CreateUser', { userId: '3' });
      });
    });

    describe('updateUser', () => {
      beforeEach(async () => {
        await staking.createUser(alice, alicePoker, aliceFinancier, 0, { from: bob });
      });

      it('should allow the current admin updating their keys', async function() {
        const res = await staking.updateUser(1, bob, bobPoker, bobFinancier, { from: alice });
        expectEvent(res, 'UpdateUser', {
          userId: '1',
          adminKey: bob,
          pokerKey: bobPoker,
          financierKey: bobFinancier,
        });
        const user = await staking.users(1);
        expect(user.adminKey).to.equal(bob);
        expect(user.pokerKey).to.equal(bobPoker);
        expect(user.financierKey).to.equal(bobFinancier);
      });

      it('should deny non-admin updating their keys', async function() {
        await expect(staking.updateUser(1, bob, bobPoker, bobFinancier, { from: aliceFinancier }))
          .to.be.revertedWith('PowerOracleStaking::updateUser: Only admin allowed');
      });
    });
  });
});
