// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../PowerPokeStaking.sol";

contract MockStaking is PowerPokeStaking {
  constructor(
    address cvpToken_,
    uint256 depositTimeout_,
    uint256 withdrawTimeout_
  ) public PowerPokeStaking(cvpToken_, depositTimeout_, withdrawTimeout_) {}

  function mockSetTotalDeposit(uint256 totalDeposit_) external {
    totalDeposit = totalDeposit_;
  }

  event MockSlash(uint256 userId, uint256 times);

  function slashHDH(uint256 slasherId_, uint256 times_) external override(PowerPokeStaking) {
    emit MockSlash(slasherId_, times_);
  }

  function mockSetReporter(uint256 userId_, uint256 highestDeposit_) external {
    _hdhId = userId_;
    _highestDeposit = highestDeposit_;
  }

  function mockSetUser(
    uint256 userId_,
    address adminKey_,
    address pokerKey_,
    uint256 deposit_
  ) external {
    users[userId_].adminKey = adminKey_;
    users[userId_].pokerKey = pokerKey_;
    users[userId_].deposit = deposit_;
  }

  function mockSetUserAdmin(uint256 userId_, address adminKey_) external {
    users[userId_].adminKey = adminKey_;
  }

  function mockSetUserDeposit(uint256 userId_, uint256 deposit_) external {
    users[userId_].deposit = deposit_;
  }
}
