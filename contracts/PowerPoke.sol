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
import "./utils/Ownable.sol";
import "./utils/Pausable.sol";
import "./PowerPokeStaking.sol";

contract PowerPoke is Ownable, Initializable, ReentrancyGuard {
  using SafeMath for uint256;

  uint256 public constant HUNDRED_PCT = 100 ether;
  uint256 public constant HUNDRED_K = 100_000;

  struct Client {
    bool active;
    bool canSlash;
    address owner;
    uint256 credit;
    uint256 minReportInterval;
    uint256 maxReportInterval;
    uint256 slasherHeartbeat;
    uint256 gasPriceLimit;
    uint256 minPokerDeposit;
    uint256 minSlasherDeposit;
  }

  event RewardUser(
    address indexed client,
    uint256 indexed userId,
    uint256 indexed compensationPlan,
    bool rewardInETH,
    uint256 gasUsed,
    uint256 gasPrice,
    uint256 gasCompensationCVP,
    uint256 bonusCVP,
    uint256 compensatedInETH,
    uint256 userDeposit,
    uint256 ethPrice,
    uint256 cvpPrice,
    uint256 calculatedReward
  );

  struct CompensationPlan {
    uint64 bonusNumerator;
    uint64 bonusDenominator;
    uint128 perGas;
  }

  struct PokeRewardOptions {
    address to;
    bool rewardInEth;
  }

  struct RewardHelperStruct {
    uint256 gasPrice;
    uint256 ethPrice;
    uint256 cvpPrice;
    uint256 gasCompensationCVP;
    uint256 bonusCVP;
    uint256 totalCVPReward;
    uint256 compensatedInETH;
  }

  event SetReportIntervals(address indexed client, uint256 minReportInterval, uint256 maxReportInterval);

  event SetGasPriceLimit(address indexed client, uint256 gasPriceLimit);

  event SetSlasherHeartbeat(address indexed client, uint256 slasherHeartbeat);

  event SetCompensationPlan(
    address indexed client,
    uint256 planId,
    uint64 bonusNominator,
    uint64 bonsuDenominator,
    uint128 perGas
  );

  event SetMinimalDeposits(address indexed client, uint256 minPokerDeposit, uint256 minSlasherDeposit);

  event WithdrawRewards(uint256 indexed userId, address indexed to, uint256 amount);

  event AddCredit(address indexed client, uint256 amount);

  event WithdrawCredit(address indexed client, address indexed to, uint256 amount);

  event SetOracle(address indexed oracle);

  event AddClient(address indexed client, address indexed owner, bool canSlash_, uint256 gasPriceLimit_);

  event SetClientActiveFlag(address indexed client_, bool indexed active);

  address public immutable WETH_TOKEN;

  IERC20 public immutable CVP_TOKEN;

  IEACAggregatorProxy public immutable FAST_GAS_ORACLE;

  PowerPokeStaking public immutable POWER_POKE_STAKING;

  IUniswapV2Router02 public immutable UNISWAP_ROUTER;

  IPowerOracle public oracle;

  uint256 public totalCredits;

  mapping(uint256 => uint256) public rewards;

  mapping(address => Client) public clients;

  mapping(address => mapping(uint256 => CompensationPlan)) public compensationPlans;

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

  function authorizeReporter(uint256 userId_, address pokerKey_) external view {
    POWER_POKE_STAKING.authorizeHDH(userId_, pokerKey_);
  }

  function authorizeNonReporter(uint256 userId_, address pokerKey_) external view {
    POWER_POKE_STAKING.authorizeNonHDH(userId_, pokerKey_, clients[msg.sender].minSlasherDeposit);
  }

  function authorizeNonReporter(
    uint256 userId_,
    address pokerKey_,
    uint256 overrideMinDeposit_
  ) external view {
    POWER_POKE_STAKING.authorizeNonHDH(userId_, pokerKey_, overrideMinDeposit_);
  }

  function authorizePoker(uint256 userId_, address pokerKey_) external view {
    POWER_POKE_STAKING.authorizeMember(userId_, pokerKey_, clients[msg.sender].minPokerDeposit);
  }

  function authorizePoker(
    uint256 userId_,
    address pokerKey_,
    uint256 overrideMinStake_
  ) external view {
    POWER_POKE_STAKING.authorizeMember(userId_, pokerKey_, overrideMinStake_);
  }

  function slashReporter(uint256 userId_, uint256 amount_) external {
    require(clients[msg.sender].active, "INVALID_CLIENT");
    require(clients[msg.sender].canSlash, "CANT_SLASH");
    if (amount_ == 0) {
      return;
    }

    POWER_POKE_STAKING.slashHDH(userId_, amount_);
  }

  function reward(
    uint256 userId_,
    uint256 gasUsed_,
    uint256 compensationPlan_,
    bytes calldata pokeOptions_
  ) external nonReentrant {
    RewardHelperStruct memory helper;
    require(clients[msg.sender].active, "INVALID_CLIENT");
    if (gasUsed_ == 0) {
      return;
    }
    helper.ethPrice = oracle.getPriceByAsset(WETH_TOKEN);
    helper.cvpPrice = oracle.getPriceByAsset(address(CVP_TOKEN));

    helper.gasPrice = getGasPriceFor(msg.sender);
    helper.gasCompensationCVP = helper.gasPrice.mul(gasUsed_).mul(helper.ethPrice) / helper.cvpPrice;
    uint256 userDeposit = POWER_POKE_STAKING.getDepositOf(userId_);

    if (userDeposit != 0) {
      helper.bonusCVP = getPokerBonus(msg.sender, compensationPlan_, gasUsed_, userDeposit);
    }

    helper.totalCVPReward = helper.gasCompensationCVP.add(helper.bonusCVP);
    require(clients[msg.sender].credit >= helper.totalCVPReward, "NOT_ENOUGH_CREDITS");
    clients[msg.sender].credit = clients[msg.sender].credit.sub(helper.totalCVPReward);

    PokeRewardOptions memory opts = abi.decode(pokeOptions_, (PokeRewardOptions));

    if (opts.rewardInEth) {
      helper.compensatedInETH = _payoutCompensationInETH(opts.to, helper.gasCompensationCVP);
      rewards[userId_] = rewards[userId_].add(helper.bonusCVP);
    } else {
      rewards[userId_] = rewards[userId_].add(helper.totalCVPReward);
    }

    emit RewardUser(
      msg.sender,
      userId_,
      compensationPlan_,
      opts.rewardInEth,
      gasUsed_,
      helper.gasPrice,
      helper.gasCompensationCVP,
      helper.bonusCVP,
      helper.compensatedInETH,
      userDeposit,
      helper.ethPrice,
      helper.cvpPrice,
      helper.totalCVPReward
    );
  }

  function getPokerBonus(
    address client_,
    uint256 compensationPlanId_,
    uint256 gasUsed_,
    uint256 userDeposit_
  ) public view returns (uint256) {
    CompensationPlan memory plan = compensationPlans[client_][compensationPlanId_];
    return (gasUsed_ / plan.perGas + 1).mul(userDeposit_).mul(plan.bonusNumerator).div(plan.bonusDenominator);
  }

  function addCredit(address client_, uint256 amount_) external {
    Client storage client = clients[client_];

    CVP_TOKEN.transferFrom(msg.sender, address(this), amount_);
    client.credit = client.credit.add(amount_);

    emit AddCredit(client_, amount_);
  }

  function withdrawCredit(
    address client_,
    address to_,
    uint256 amount_
  ) external onlyClientOwner(client_) {
    Client storage client = clients[client_];

    client.credit = client.credit.sub(amount_);

    CVP_TOKEN.transfer(to_, amount_);

    emit WithdrawCredit(client_, to_, amount_);
  }

  function setReportIntervals(
    address client_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) external onlyClientOwner(client_) {
    require(minReportInterval_ > maxReportInterval_ && minReportInterval_ > 0, "INVALID_REPORT_INTERVALS");
    clients[client_].minReportInterval = minReportInterval_;
    clients[client_].maxReportInterval = maxReportInterval_;
    emit SetReportIntervals(client_, minReportInterval_, maxReportInterval_);
  }

  function setSlasherHearbeat(address client_, uint256 slasherHeartbeat_) external onlyClientOwner(client_) {
    clients[client_].slasherHeartbeat = slasherHeartbeat_;
    emit SetSlasherHeartbeat(client_, slasherHeartbeat_);
  }

  function setGasPriceLimit(address client_, uint256 gasPriceLimit_) external onlyClientOwner(client_) {
    clients[client_].gasPriceLimit = gasPriceLimit_;
    emit SetGasPriceLimit(client_, gasPriceLimit_);
  }

  function setCompensationPlan(
    address client_,
    uint256 planId_,
    uint64 bonusNominator_,
    uint64 bonusDenominator_,
    uint128 perGas_
  ) external onlyClientOwner(client_) {
    compensationPlans[client_][planId_] = CompensationPlan(bonusNominator_, bonusDenominator_, perGas_);
    emit SetCompensationPlan(client_, planId_, bonusNominator_, bonusDenominator_, perGas_);
  }

  function setMinimalDeposits(
    address client_,
    uint256 minPokerDeposit_,
    uint256 minSlasherDeposit_
  ) external onlyClientOwner(client_) {
    clients[client_].minPokerDeposit = minPokerDeposit_;
    clients[client_].minSlasherDeposit = minSlasherDeposit_;
    emit SetMinimalDeposits(client_, minPokerDeposit_, minSlasherDeposit_);
  }

  function withdrawRewards(uint256 userId_, address to_) external {
    POWER_POKE_STAKING.requireValidAdminKey(userId_, msg.sender);
    require(to_ != address(0), "0_ADDRESS");
    uint256 rewardAmount = rewards[userId_];
    require(rewardAmount > 0, "NOTHING_TO_WITHDRAW");
    rewards[userId_] = 0;

    CVP_TOKEN.transfer(to_, rewardAmount);

    emit WithdrawRewards(userId_, to_, rewardAmount);
  }

  function addClient(
    address client_,
    address owner_,
    bool canSlash_,
    uint256 gasPriceLimit_,
    uint256 minReportInterval_,
    uint256 maxReportInterval_
  ) external onlyOwner {
    require(maxReportInterval_ > minReportInterval_ && minReportInterval_ > 0, "INVALID_REPORT_INTERVALS");

    Client storage c = clients[client_];
    c.active = true;
    c.canSlash = canSlash_;
    c.owner = owner_;
    c.gasPriceLimit = gasPriceLimit_;
    c.minReportInterval = minReportInterval_;
    c.maxReportInterval = maxReportInterval_;
    c.slasherHeartbeat = uint256(-1);

    emit AddClient(client_, owner_, canSlash_, gasPriceLimit_);
  }

  function setClientActiveFlag(address client_, bool active_) external onlyOwner {
    clients[client_].active = active_;
    emit SetClientActiveFlag(client_, active_);
  }

  function setOracle(address oracle_) external onlyOwner {
    oracle = IPowerOracle(oracle_);
    emit SetOracle(oracle_);
  }

  function getMinMaxReportIntervals(address client_) external view returns (uint256 min, uint256 max) {
    return (clients[client_].minReportInterval, clients[client_].maxReportInterval);
  }

  function getSlasherHeartbeat(address client_) external view returns (uint256) {
    return clients[client_].slasherHeartbeat;
  }

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

  function getGasPriceFor(address client_) public view returns (uint256) {
    return Math.min(tx.gasprice, Math.min(_latestFastGas(), clients[client_].gasPriceLimit));
  }
}
