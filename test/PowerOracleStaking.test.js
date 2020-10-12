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

  let deployer, owner, powerOracle, alice, bob, charlie, alicePoker, aliceFinancier, bobPoker, bobFinancier, sink;

  before(async function() {
    [deployer, owner, powerOracle, alice, bob, charlie, alicePoker, aliceFinancier, bobPoker, bobFinancier, sink] = await web3.eth.getAccounts();
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

    describe('deposit', () => {
      beforeEach(async () => {
        await staking.createUser(alice, alicePoker, aliceFinancier, 0, { from: bob });
      });

      it('should allow anyone depositing multiple times for a given user ID', async function() {
        await cvpToken.transfer(bob, ether(50), { from: deployer });
        await cvpToken.transfer(charlie, ether(50), { from: deployer });
        await cvpToken.approve(staking.address, ether(50), { from: bob });
        await cvpToken.approve(staking.address, ether(50), { from: charlie });

        let res = await staking.deposit(1, ether(10), { from: bob });
        expectEvent(res, 'Deposit', {
          userId: '1',
          depositor: bob,
          amount: ether(10),
          depositAfter: ether(10)
        })

        res = await staking.deposit(1, ether(10), { from: charlie });
        expectEvent(res, 'Deposit', {
          userId: '1',
          depositor: charlie,
          amount: ether(10),
          depositAfter: ether(20)
        })
      });

      it('should update the reporter and the highest deposit values if needed', async function() {
        await staking.createUser(bob, bobPoker, bobFinancier, 0, { from: bob });

        await cvpToken.transfer(bob, ether(150), { from: deployer });
        await cvpToken.approve(staking.address, ether(150), { from: bob });

        expect(await staking.getReporterId()).to.be.equal('0');

        let res = await staking.deposit(1, ether(10), { from: bob });
        expectEvent(res, 'ReporterChange', {
          prevId: '0',
          nextId: '1',
          highestDepositPrev: '0',
          actualDepositPrev: '0',
          actualDepositNext: ether(10),
        })

        res = await staking.deposit(2, ether(15), { from: bob });
        expectEvent(res, 'ReporterChange', {
          prevId: '1',
          nextId: '2',
          highestDepositPrev: ether(10),
          actualDepositPrev: ether(10),
          actualDepositNext: ether(15),
        })

        res = await staking.deposit(1, ether(5), { from: bob });
        expectEvent.notEmitted(res, 'ReporterChange')
      });

      it('should deny depositing 0 ', async function() {
        await expect(staking.deposit(1, 0, { from: bob }))
          .to.be.revertedWith('PowerOracleStaking::deposit: Missing amount');
      });

      it('should deny depositing for a non-existing user', async function() {
        await expect(staking.deposit(3, ether(30), { from: bob }))
          .to.be.revertedWith('PowerOracleStaking::deposit: Admin key can\'t be empty');
      });
    })

    describe('withdraw', () => {
      const USER_ID = 42;

      beforeEach(async () => {
        await staking.setUser(USER_ID, alice, alicePoker, aliceFinancier, ether(100), { from: bob });
        await cvpToken.transfer(staking.address, ether(500), { from: deployer });
      });

      it('should allow the users financier key withdrawing all the deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        const res = await staking.withdraw(USER_ID, sink, ether(100), { from: aliceFinancier });
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('100'));

        expectEvent(res, 'Withdraw', {
          userId: '42',
          financier: aliceFinancier,
          to: sink,
          amount: ether(100),
          depositAfter: '0'
        });
      });

      it('should allow the users financier key withdrawing part of the deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        const res = await staking.withdraw(USER_ID, sink, ether(30), { from: aliceFinancier });
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('30'));

        expectEvent(res, 'Withdraw', {
          userId: '42',
          financier: aliceFinancier,
          to: sink,
          amount: ether(30),
          depositAfter: ether(70)
        });
      });

      it('should deny non-financier withdrawing rewards', async function() {
        await expect(staking.withdraw(USER_ID, sink, ether(30), { from: alice }))
          .to.be.revertedWith('PowerOracleStaking::withdraw: Only user\'s financier key allowed');
      });

      it('should deny withdrawing more than the rewards balance', async function() {
        await expect(staking.withdraw(USER_ID, sink, ether(101), { from: aliceFinancier }))
          .to.be.revertedWith('PowerOracleStaking::withdraw: Amount exceeds deposit');
      });
    });
  });

});
