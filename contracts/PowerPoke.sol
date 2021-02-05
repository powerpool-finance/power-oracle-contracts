// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/upgrades-core/contracts/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./interfaces/IPowerOracle.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IEACAggregatorProxy.sol";
import "./interfaces/IPowerPoke.sol";
import "./utils/Ownable.sol";
import "./utils/Pausable.sol";
import "./PowerPokeStaking.sol";
import "./PowerPokeStorageV1.sol";

contract PowerPoke is IPowerPoke, Ownable, Initializable, ReentrancyGuard, PowerPokeStorageV1 {
  using SafeMath for uint256;

  event RewardUser(
    address indexed client,
    uint256 indexed userId,
    uint256 indexed bonusPlan,
    bool compensateInETH,
    uint256 gasUsed,
    uint256 gasPrice,
    uint256 userDeposit,
    uint256 ethPrice,
    uint256 cvpPrice,
    uint256 compensationEvaluationCVP,
    uint256 bonusCVP,
    uint256 earnedCVP,
    uint256 earnedETH
  );

  event SetReportIntervals(address indexed client, uint256 minReportInterval, uint256 maxReportInterval);

  event SetGasPriceLimit(address indexed client, uint256 gasPriceLimit);

  event SetSlasherHeartbeat(address indexed client, uint256 slasherHeartbeat);

  event SetBonusPlan(
    address indexed client,
    uint256 indexed planId,
    bool indexed active,
    uint64 bonusNominator,
    uint64 bonsuDenominator,
    uint128 perGas
  );

  event SetDefaultMinDeposit(address indexed client, uint256 defaultMinDeposit);

  event WithdrawRewards(uint256 indexed userId, address indexed to, uint256 amount);

  event AddCredit(address indexed client, uint256 amount);

  event WithdrawCredit(address indexed client, address indexed to, uint256 amount);

  event SetOracle(address indexed oracle);

  event AddClient(
    address indexed client,
    address indexed owner,
    bool canSlash,
    uint256 gasPriceLimit,
    uint256 minReportInterval,
    uint256 maxReportInterval,
    uint256 slasherHeartbeat
  );

  event SetClientActiveFlag(address indexed client, bool indexed active);

  event SetCanSlashFlag(address indexed client, bool indexed canSlash);

  event SetPokerKeyRewardWithdrawAllowance(uint256 indexed userId, bool allow);

  struct PokeRewardOptions {
    address to;
    bool compensateInETH;
  }

  struct RewardHelperStruct {
    uint256 gasPrice;
    uint256 ethPrice;
    uint256 cvpPrice;
    uint256 totalInCVP;
    uint256 compensationCVP;
    uint256 bonusCVP;
    uint256 earnedCVP;
    uint256 earnedETH;
  }

  address public immutable WETH_TOKEN;

  IERC20 public immutable CVP_TOKEN;

  IEACAggregatorProxy public immutable FAST_GAS_ORACLE;

  PowerPokeStaking public immutable POWER_POKE_STAKING;

  IUniswapV2Router02 public immutable UNISWAP_ROUTER;

  modifier onlyClientOwner(address client_) {
    require(clients[client_].owner == msg.sender, "ONLY_CLIENT_OWNER");
    _;
  }

  constructor(
    address cvpToken_,
    address wethToken_,
    address fastGasOracle_,
    address uniswapRouter_,
    address powerPokeStaking_
  ) public {
    require(cvpToken_ != address(0), "CVP_ADDR_IS_0");
    require(wethToken_ != address(0), "WETH_ADDR_IS_0");
    require(fastGasOracle_ != address(0), "FAST_GAS_ORACLE_IS_0");
    require(uniswapRouter_ != address(0), "UNISWAP_ROUTER_IS_0");
    require(powerPokeStaking_ != address(0), "POWER_POKE_STAKING_ADDR_IS_0");

    CVP_TOKEN = IERC20(cvpToken_);
    WETH_TOKEN = wethToken_;
    FAST_GAS_ORACLE = IEACAggregatorProxy(fastGasOracle_);
    POWER_POKE_STAKING = PowerPokeStaking(powerPokeStaking_);
    UNISWAP_ROUTER = IUniswapV2Router02(uniswapRouter_);
  }

  function initialize(address owner_, address oracle_) external initializer {
    _transferOwnership(owner_);
    oracle = IPowerOracle(oracle_);
  }

  /*** CLIENT'S CONTRACT INTERFACE ***/
  function authorizeReporter(uint256 userId_, address pokerKey_) external view override {
    POWER_POKE_STAKING.authorizeHDH(userId_, pokerKey_);
  }

  function authorizeNonReporter(uint256 userId_, address pokerKey_) external view override {
    POWER_POKE_STAKING.authorizeNonHDH(userId_, pokerKey_, clients[msg.sender].defaultMinDeposit);
  }

  function authorizeNonReporterWithDeposit(
    uint256 userId_,
    address pokerKey_,
    uint256 overrideMinDeposit_
  ) external view override {
    POWER_POKE_STAKING.authorizeNonHDH(userId_, pokerKey_, overrideMinDeposit_);
  }

  function authorizePoker(uint256 userId_, address pokerKey_) external view override {
    POWER_POKE_STAKING.authorizeMember(userId_, pokerKey_, clients[msg.sender].defaultMinDeposit);
  }

  function authorizePokerWithDeposit(
    uint256 userId_,
    address pokerKey_,
    uint256 overrideMinStake_
  ) external view override {
    POWER_POKE_STAKING.authorizeMember(userId_, pokerKey_, overrideMinStake_);
  }

  function slashReporter(uint256 slasherId_, uint256 times_) external override nonReentrant {
    require(clients[msg.sender].active, "INVALID_CLIENT");
    require(clients[msg.sender].canSlash, "CANT_SLASH");
    if (times_ == 0) {
      return;
    }

    POWER_POKE_STAKING.slashHDH(slasherId_, times_);
  }

  function reward(
    uint256 userId_,
    uint256 gasUsed_,
    uint256 compensationPlan_,
    bytes calldata pokeOptions_
  ) external override nonReentrant {
    RewardHelperStruct memory helper;
    require(clients[msg.sender].active, "INVALID_CLIENT");
    if (gasUsed_ == 0) {
      return;
    }
    helper.ethPrice = oracle.getPriceByAsset(WETH_TOKEN);
    helper.cvpPrice = oracle.getPriceByAsset(address(CVP_TOKEN));

    helper.gasPrice = getGasPriceFor(msg.sender);
    helper.compensationCVP = helper.gasPrice.mul(gasUsed_).mul(helper.ethPrice) / helper.cvpPrice;
    uint256 userDeposit = POWER_POKE_STAKING.getDepositOf(userId_);

    if (userDeposit != 0) {
      helper.bonusCVP = getPokerBonus(msg.sender, compensationPlan_, gasUsed_, userDeposit);
    }

    helper.totalInCVP = helper.compensationCVP.add(helper.bonusCVP);
    require(clients[msg.sender].credit >= helper.totalInCVP, "NOT_ENOUGH_CREDITS");
    clients[msg.sender].credit = clients[msg.sender].credit.sub(helper.totalInCVP);

    PokeRewardOptions memory opts = abi.decode(pokeOptions_, (PokeRewardOptions));

    if (opts.compensateInETH) {
      helper.earnedCVP = helper.bonusCVP;
      rewards[userId_] = rewards[userId_].add(helper.bonusCVP);
      helper.earnedETH = _payoutCompensationInETH(opts.to, helper.compensationCVP);
    } else {
      helper.earnedCVP = helper.compensationCVP.add(helper.bonusCVP);
      rewards[userId_] = rewards[userId_].add(helper.earnedCVP);
    }

    emit RewardUser(
      msg.sender,
      userId_,
      compensationPlan_,
      opts.compensateInETH,
      gasUsed_,
      helper.gasPrice,
      userDeposit,
      helper.ethPrice,
      helper.cvpPrice,
      helper.compensationCVP,
      helper.bonusCVP,
      helper.earnedCVP,
      helper.earnedETH
    );
  }

  /*** CLIENT OWNER INTERFACE ***/
  function addCredit(address client_, uint256 amount_) override external {
    Client storage client = clients[client_];

    require(client.active, "ONLY_ACTIVE_CLIENT");

    CVP_TOKEN.transferFrom(msg.sender, address(this), amount_);
    client.credit = client.credit.add(amount_);
    totalCredits = totalCredits.add(amount_);

    emit AddCredit(client_, amount_);
  }

  function withdrawCredit(
    address client_,
    address to_,
    uint256 amount_
  ) external override onlyClientOwner(client_) {
    Client storage client = clients[client_];

    client.credit = client.credit.sub(amount_);
    totalCredits = totalCredits.sub(amount_);

    CVP_TOKEN.transfer(to_, amount_);

    emit WithdrawCredit(client_, to_, amount_);
  }

  function setReportIntervals(
    address client_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) external override onlyClientOwner(client_) {
    require(maxReportInterval_ > minReportInterval_ && minReportInterval_ > 0, "INVALID_REPORT_INTERVALS");
    clients[client_].minReportInterval = minReportInterval_;
    clients[client_].maxReportInterval = maxReportInterval_;
    emit SetReportIntervals(client_, minReportInterval_, maxReportInterval_);
  }

  function setSlasherHeartbeat(address client_, uint256 slasherHeartbeat_) external override onlyClientOwner(client_) {
    clients[client_].slasherHeartbeat = slasherHeartbeat_;
    emit SetSlasherHeartbeat(client_, slasherHeartbeat_);
  }

  function setGasPriceLimit(address client_, uint256 gasPriceLimit_) external override onlyClientOwner(client_) {
    clients[client_].gasPriceLimit = gasPriceLimit_;
    emit SetGasPriceLimit(client_, gasPriceLimit_);
  }

  function setBonusPlan(
    address client_,
    uint256 planId_,
    bool active_,
    uint64 bonusNominator_,
    uint64 bonusDenominator_,
    uint64 perGas_
  ) external override onlyClientOwner(client_) {
    bonusPlans[client_][planId_] = BonusPlan(active_, bonusNominator_, bonusDenominator_, perGas_);
    emit SetBonusPlan(client_, planId_, active_, bonusNominator_, bonusDenominator_, perGas_);
  }

  function setMinimalDeposit(address client_, uint256 defaultMinDeposit_) external override onlyClientOwner(client_) {
    clients[client_].defaultMinDeposit = defaultMinDeposit_;
    emit SetDefaultMinDeposit(client_, defaultMinDeposit_);
  }

  /*** POKER INTERFACE ***/
  function withdrawRewards(uint256 userId_, address to_) external override {
    if (pokerKeyRewardWithdrawAllowance[userId_] == true) {
      POWER_POKE_STAKING.requireValidAdminOrPokerKey(userId_, msg.sender);
    } else {
      POWER_POKE_STAKING.requireValidAdminKey(userId_, msg.sender);
    }
    require(to_ != address(0), "0_ADDRESS");
    uint256 rewardAmount = rewards[userId_];
    require(rewardAmount > 0, "NOTHING_TO_WITHDRAW");
    rewards[userId_] = 0;

    CVP_TOKEN.transfer(to_, rewardAmount);

    emit WithdrawRewards(userId_, to_, rewardAmount);
  }

  function setPokerKeyRewardWithdrawAllowance(uint256 userId_, bool allow_) external override {
    POWER_POKE_STAKING.requireValidAdminKey(userId_, msg.sender);
    pokerKeyRewardWithdrawAllowance[userId_] = allow_;
    emit SetPokerKeyRewardWithdrawAllowance(userId_, allow_);
  }

  /*** OWNER INTERFACE ***/
  function addClient(
    address client_,
    address owner_,
    bool canSlash_,
    uint256 gasPriceLimit_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) external override onlyOwner {
    require(maxReportInterval_ > minReportInterval_ && minReportInterval_ > 0, "INVALID_REPORT_INTERVALS");

    Client storage c = clients[client_];
    c.active = true;
    c.canSlash = canSlash_;
    c.owner = owner_;
    c.gasPriceLimit = gasPriceLimit_;
    c.minReportInterval = minReportInterval_;
    c.maxReportInterval = maxReportInterval_;
    c.slasherHeartbeat = uint256(-1);

    emit AddClient(client_, owner_, canSlash_, gasPriceLimit_, minReportInterval_, maxReportInterval_, uint256(-1));
  }

  function setClientActiveFlag(address client_, bool active_) external override onlyOwner {
    clients[client_].active = active_;
    emit SetClientActiveFlag(client_, active_);
  }

  function setCanSlashFlag(address client_, bool canSlash) external override onlyOwner {
    clients[client_].active = canSlash;
    emit SetCanSlashFlag(client_, canSlash);
  }

  function setOracle(address oracle_) external override onlyOwner {
    oracle = IPowerOracle(oracle_);
    emit SetOracle(oracle_);
  }

  /*** INTERNAL HELPERS ***/
  function _payoutCompensationInETH(address _to, uint256 _cvpAmount) internal returns (uint256) {
    CVP_TOKEN.approve(address(UNISWAP_ROUTER), _cvpAmount);

    address[] memory path = new address[](2);
    path[0] = address(CVP_TOKEN);
    path[1] = address(WETH_TOKEN);

    uint256[] memory amounts = UNISWAP_ROUTER.swapExactTokensForETH(_cvpAmount, uint256(0), path, _to, now.add(1800));
    return amounts[1];
  }

  function _latestFastGas() internal view returns (uint256) {
    return uint256(FAST_GAS_ORACLE.latestAnswer());
  }

  /*** GETTERS ***/
  function creditOf(address client_) external view override returns (uint256) {
    return clients[client_].credit;
  }

  function ownerOf(address client_) external view override returns (address) {
    return clients[client_].owner;
  }

  function getMinMaxReportIntervals(address client_) external view override returns (uint256 min, uint256 max) {
    return (clients[client_].minReportInterval, clients[client_].maxReportInterval);
  }

  function getSlasherHeartbeat(address client_) external view override returns (uint256) {
    return clients[client_].slasherHeartbeat;
  }

  function getGasPriceLimit(address client_) external view override returns (uint256) {
    return clients[client_].gasPriceLimit;
  }

  function getPokerBonus(
    address client_,
    uint256 bonusPlanId_,
    uint256 gasUsed_,
    uint256 userDeposit_
  ) public view override returns (uint256) {
    BonusPlan memory plan = bonusPlans[client_][bonusPlanId_];
    require(plan.active, "INACTIVE_BONUS_PLAN");

    // gasUsed_ * userDeposit_ * plan.bonusNumerator / bonusDenominator / plan.perGas
    return gasUsed_.mul(userDeposit_).mul(plan.bonusNumerator) / plan.bonusDenominator / plan.perGas;
  }

  function getGasPriceFor(address client_) public view override returns (uint256) {
    return Math.min(tx.gasprice, Math.min(_latestFastGas(), clients[client_].gasPriceLimit));
  }
}
