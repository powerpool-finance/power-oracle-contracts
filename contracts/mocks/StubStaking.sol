// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../PowerPokeStaking.sol";

contract StubStaking is PowerPokeStaking {
  constructor(address cvpToken_) public PowerPokeStaking(cvpToken_) {}

  function stubSetTotalDeposit(uint256 totalDeposit_) external {
    totalDeposit = totalDeposit_;
  }

  function stubSetReporter(uint256 userId_, uint256 highestDeposit_) external {
    _hdhId = userId_;
    _highestDeposit = highestDeposit_;
  }

  function stubSetUser(
    uint256 userId_,
    address adminKey_,
    address pokerKey_,
    uint256 deposit_
  ) external {
    users[userId_].adminKey = adminKey_;
    users[userId_].pokerKey = pokerKey_;
    users[userId_].deposit = deposit_;
  }

  function stubSetUserDeposit(uint256 userId_, uint256 deposit_) external {
    users[userId_].deposit = deposit_;
  }
}
