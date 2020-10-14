const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { K, ether, deployProxied } = require('./helpers');
const { getTokenConfigs  } = require('./localHelpers');

const { solidity } = require('ethereum-waffle');

const chai = require('chai');
const MockCVP = artifacts.require('MockCVP');
const MockOracle = artifacts.require('MockOracle');
const StubStaking = artifacts.require('StubStaking');

chai.use(solidity);
const { expect } = chai;

MockCVP.numberFormat = 'String';
StubStaking.numberFormat = 'String';

const MINIMAL_SLASHING_DEPOSIT = ether(50);
const SLASHER_SLASHING_REWARD_PCT = ether(5);
const PROTOCOL_SLASHING_REWARD_PCT = ether('1.5');
const SET_USER_REWARD_COUNT = 3;

describe('PowerOracleStaking', function () {
  let staking;
  let cvpToken;

  let deployer, owner, powerOracle, alice, bob, charlie, alicePoker, aliceFinancier, bobPoker, bobFinancier, sink, reservoir;

  before(async function() {
    [deployer, owner, powerOracle, alice, bob, charlie, alicePoker, aliceFinancier, bobPoker, bobFinancier, sink, reservoir] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvpToken = await MockCVP.new(ether(1e9));
    staking = await deployProxied(
      StubStaking,
      [cvpToken.address, reservoir],
      [owner, powerOracle, MINIMAL_SLASHING_DEPOSIT, SLASHER_SLASHING_REWARD_PCT, PROTOCOL_SLASHING_REWARD_PCT, SET_USER_REWARD_COUNT],
      { proxyAdminOwner: owner }
    );
  });

  describe('initialization', () => {
    it('should initialize correctly', async function() {
      expect(await staking.cvpToken()).to.be.equal(cvpToken.address);
      expect(await staking.owner()).to.be.equal(owner);
      expect(await staking.powerOracle()).to.be.equal(powerOracle);
      expect(await staking.minimalSlashingDeposit()).to.be.equal(MINIMAL_SLASHING_DEPOSIT);
      expect(await staking.slasherSlashingRewardPct()).to.be.equal(SLASHER_SLASHING_REWARD_PCT);
      expect(await staking.protocolSlashingRewardPct()).to.be.equal(PROTOCOL_SLASHING_REWARD_PCT);
      expect(await staking.setUserRewardCount()).to.be.equal(SET_USER_REWARD_COUNT.toString());
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

        expect(await staking.totalDeposit()).to.be.equal(ether(10));

        res = await staking.deposit(1, ether(10), { from: charlie });
        expectEvent(res, 'Deposit', {
          userId: '1',
          depositor: charlie,
          amount: ether(10),
          depositAfter: ether(20)
        })

        expect(await staking.totalDeposit()).to.be.equal(ether(20));
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
        await staking.stubSetUser(USER_ID, alice, alicePoker, aliceFinancier, ether(100), { from: bob });
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(500), { from: deployer });
      });

      it('should allow the users financier key withdrawing all the deposit', async function() {
        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        expect(await staking.totalDeposit()).to.be.equal(ether('100'));

        const res = await staking.withdraw(USER_ID, sink, ether(100), { from: aliceFinancier });

        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('100'));
        expect(await staking.totalDeposit()).to.be.equal(ether('0'));

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
        expect(await staking.totalDeposit()).to.be.equal(ether('100'));

        const res = await staking.withdraw(USER_ID, sink, ether(30), { from: aliceFinancier });

        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('30'));
        expect(await staking.totalDeposit()).to.be.equal(ether('70'));

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

  describe('owner interface', () => {
    describe('withdrawExtraCvp', () => {
      it('should allow the owner withdrawing accidentally sent CVPs from the contract', async function() {
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(120), { from: deployer });

        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        const res = await staking.withdrawExtraCVP(sink, { from: owner });
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('20'));

        expectEvent(res, 'WithdrawExtraCVP', {
          sent: true,
          to: sink,
          diff: ether(20),
          erc20Balance: ether(120),
          accountedTotalDeposits: ether(100)
        });
      });

      it('should not withdraw if there is no diff in accounted tokens', async function() {
        await staking.stubSetTotalDeposit(ether(100));
        await cvpToken.transfer(staking.address, ether(100), { from: deployer });

        expect(await cvpToken.balanceOf(sink)).to.be.equal('0');
        const res = await staking.withdrawExtraCVP(sink, { from: owner });
        expect(await cvpToken.balanceOf(sink)).to.be.equal(ether('0'));

        expectEvent(res, 'WithdrawExtraCVP', {
          sent: false,
          to: sink,
          diff: '0',
          erc20Balance: ether(100),
          accountedTotalDeposits: ether(100)
        });
      });

      it('should deny non-owner calling the method', async function() {
        await expect(staking.withdrawExtraCVP(sink, { from: alice }))
          .to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should deny withdrawing to the 0 address', async function() {
        await expect(staking.withdrawExtraCVP(constants.ZERO_ADDRESS, { from: owner }))
          .to.be.revertedWith('PowerOracleStaking::withdrawExtraCVP: Cant withdraw to 0 address');
      });
    });

    describe('setMinimalSlashingDeposit', () => {
      it('should allow the owner setting the value', async function() {
        await staking.setMinimalSlashingDeposit(42, { from: owner });
        expect(await staking.minimalSlashingDeposit()).to.be.equal('42');
      })

      it('should deny non-owner setting the value', async function() {
        await expect(staking.setMinimalSlashingDeposit(42, { from: alice }))
          .to.be.revertedWith('Ownable: caller is not the owner');
      })
    });

    describe('setPowerOracle', () => {
      it('should allow the owner setting the value', async function() {
        await staking.setPowerOracle(charlie, { from: owner });
        expect(await staking.powerOracle()).to.be.equal(charlie);
      })

      it('should deny non-owner setting the value', async function() {
        await expect(staking.setPowerOracle(charlie, { from: alice }))
          .to.be.revertedWith('Ownable: caller is not the owner');
      })
    })

    describe('setSlashingPct', () => {
      it('should allow the owner setting the value', async function() {
        await staking.setSlashingPct(ether(40), ether(30), { from: owner });
        expect(await staking.slasherSlashingRewardPct()).to.be.equal(ether(40));
        expect(await staking.protocolSlashingRewardPct()).to.be.equal(ether(30));
      })

      it('should deny a slasher and the protocol reward more than 100%', async function() {
        await expect(staking.setSlashingPct(ether(50), ether(51), { from: owner }))
          .to.be.revertedWith('PowerOracleStaking::setSlashingPct: Invalid reward sum');
      })

      it('should deny non-owner setting the value', async function() {
        await expect(staking.setSlashingPct(ether(40), ether(30), { from: alice }))
          .to.be.revertedWith('Ownable: caller is not the owner');
      })
    });
  });

  describe('setReporter', () => {
    beforeEach(async function() {
      const powerOracle = await MockOracle.new(cvpToken.address, constants.ZERO_ADDRESS, 1, await getTokenConfigs());
      await staking.setPowerOracle(powerOracle.address, { from: owner });
    });

    it('should allow setting reporter if there is another user with a higher deposit', async function() {
      await staking.stubSetUser(1, alice, alicePoker, aliceFinancier, ether(100), { from: bob });
      await staking.stubSetUser(2, bob, bobPoker, bobFinancier, ether(200), { from: bob });

      await staking.stubSetReporter(1, ether(300));
      expect(await staking.getReporterId()).to.be.equal('1');
      expect(await staking.getHighestDeposit()).to.be.equal(ether(300));

      await staking.setReporter(2);
      expect(await staking.getReporterId()).to.be.equal('2');
      expect(await staking.getHighestDeposit()).to.be.equal(ether(200));
    });

    it('should reward a setter', async function() {
      await staking.stubSetUser(1, alice, alicePoker, aliceFinancier, ether(100), { from: bob });
      await staking.stubSetUser(2, bob, bobPoker, bobFinancier, ether(200), { from: bob });

      await staking.stubSetReporter(1, ether(300));

      expect(await cvpToken.balanceOf(charlie)).to.be.equal('0');
      const res = await staking.setReporter(2, { from: charlie });
      expectEvent(res, 'SetReporter', {
        reporterId: '2',
        msgSender: charlie
      })
      expectEvent(res, 'ReporterChange', {
        prevId: '1',
        nextId: '2',
        highestDepositPrev: ether(300),
        actualDepositPrev: ether(100),
        actualDepositNext: ether(200)
      })
      expectEvent.inTransaction(res.tx, MockOracle, 'MockRewardAddress', {
        to: charlie,
        count: '3'
      })
      expect(await cvpToken.balanceOf(charlie)).to.be.equal('0');
    });
  });

  describe('slash', () => {
    const SLASHER_ID = '42';
    const REPORTER_ID = '5';

    beforeEach(async function() {
      await cvpToken.transfer(staking.address, ether(10000), { from: deployer });
      // await cvpToken.approve(staking.address, ether(10000), { from: reservoir });

      await staking.stubSetUser(REPORTER_ID, alice, alicePoker, aliceFinancier, ether(500), { from: bob });
      await staking.stubSetUser(SLASHER_ID, bob, bobPoker, bobFinancier, ether(60), { from: bob });
      await staking.stubSetReporter(REPORTER_ID, ether(600), { from: bob });
    });

    it('should allow a powerOracle slashing current reporter', async function() {
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(500));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(60));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal('0');

      const res = await staking.slash(SLASHER_ID, 4, { from: powerOracle });

      // 500 - 100 - 30 = 370
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(370));
      // 100 + 100 = 200
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(160));
      expect(await cvpToken.balanceOf(reservoir)).to.be.equal(ether(30));

      expect(await staking.getReporterId()).to.be.equal(REPORTER_ID);

      expectEvent(res, 'Slash', {
        slasherId: '42',
        reporterId: '5',
        // 500 * 5% * 4 = 25 * 4 = 100
        slasherReward: ether(100),
        // 500 * 1.5% * 4 = 7.5 * 4 = 30
        reservoirReward: ether(30)
      })
    });

    it('should change the reporterId to the slasher the reporters deposit becomes lesser', async function() {
      await staking.slash(SLASHER_ID, 4, { from: powerOracle });

      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(370));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(160));

      await staking.slash(SLASHER_ID, 4, { from: powerOracle });
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether(273.8));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether(234));

      const res = await staking.slash(SLASHER_ID, 4, { from: powerOracle });
      expect(await staking.getDepositOf(REPORTER_ID)).to.be.equal(ether('202.612'));
      expect(await staking.getDepositOf(SLASHER_ID)).to.be.equal(ether('288.76'));

      expect(await staking.getReporterId()).to.be.equal(SLASHER_ID);

      expectEvent(res, 'ReporterChange', {
        prevId: REPORTER_ID,
        nextId: SLASHER_ID,
        highestDepositPrev: ether(600),
        actualDepositPrev: ether('202.612'),
        actualDepositNext: ether('288.76')
      })
    });

    it('should deny slashing if the slasher deposit is not sufficient', async function() {
      await staking.stubSetUser(SLASHER_ID, bob, bobPoker, bobFinancier, ether(40), { from: bob });
      await expect(staking.slash(SLASHER_ID, 4, { from: owner }))
        .to.be.revertedWith('PowerOracleStaking::slash: Insufficient slasher deposit');
    });

    it('should deny non-powerOracle calling the method', async function() {
      await expect(staking.slash(SLASHER_ID, 4, { from: owner }))
        .to.be.revertedWith('PowerOracleStaking::slash: Only PowerOracle allowed');
    });
  })
});
