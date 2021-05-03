// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./PowerOracleStorageV1.sol";
import "./utils/PowerOwnable.sol";

abstract contract PowerOracleTokenManagement is PowerOwnable, PowerOracleStorageV1 {
  uint8 internal constant TOKEN_ACTIVITY_NOT_EXISTS = 0;
  uint8 internal constant TOKEN_ACTIVITY_DEPRECATED = 1;
  uint8 internal constant TOKEN_ACTIVITY_ACTIVE = 2;

  /// @notice Required only for the setup function, not persisted in the storage
  struct TokenConfigSetup {
    address token;
    string symbol;
    TokenConfig basic;
    TokenConfigUpdate update;
  }

  struct TokenConfigUpdateSetup {
    address token;
    TokenConfigUpdate update;
  }

  function addTokens(TokenConfigSetup[] memory tokenConfigs_) external onlyOwner {
    uint256 len = tokenConfigs_.length;

    for (uint256 i = 0; i < len; i++) {
      TokenConfigSetup memory tc = tokenConfigs_[i];
      address token = tc.token;

      require(tc.basic.symbolHash == keccak256(abi.encodePacked(tc.symbol)), "INVALID_SYMBOL_HASH");
      require(tokenConfigs[token].active == TOKEN_ACTIVITY_NOT_EXISTS, "ALREADY_EXISTS");
      require(tc.basic.baseUnit > 0, "BASE_UNIT_IS_NULL");

      tokenConfigs[token] = tokenConfigs_[i].basic;
      tokenUpdateConfigs[token] = tokenConfigs_[i].update;

      tokenBySymbol[tc.symbol] = token;
      tokenBySymbolHash[tc.basic.symbolHash] = token;

      tokens.push(token);
    }
    // TODO: add event
  }

  function updateTokenMarkets(TokenConfigUpdateSetup[] memory tokenUpdateConfigs_) external onlyOwner {
    uint256 len = tokenUpdateConfigs_.length;

    for (uint256 i = 0; i < len; i++) {
      address token = tokenUpdateConfigs_[i].token;
      require(tokenConfigs[token].active == TOKEN_ACTIVITY_NOT_EXISTS, "ALREADY_EXISTS");

      tokenUpdateConfigs[token] = tokenUpdateConfigs_[i].update;
    }
  }

  function deprecateTokens(address[] calldata tokens_) external onlyOwner {
    uint256 len = tokens_.length;

    for (uint256 i = 0; i < len; i++) {
      tokenConfigs[tokens_[i]].active = TOKEN_ACTIVITY_DEPRECATED;
    }
  }

  function getTokenUpdateConfig(address token_) public view returns (TokenConfigUpdate memory) {
    return tokenUpdateConfigs[token_];
  }

  function getTokenConfig(address token_) public view returns (TokenConfig memory) {
    TokenConfig memory cfg = tokenConfigs[token_];
    require(token_ != address(0) && cfg.active == TOKEN_ACTIVITY_ACTIVE, "TOKEN_NOT_FOUND");
    return tokenConfigs[token_];
  }

  function getTokenConfigBySymbolHash(bytes32 symbolHash_) public view returns (TokenConfig memory) {
    return getTokenConfig(tokenBySymbolHash[symbolHash_]);
  }

  function getTokenConfigBySymbol(string memory symbol_) public view returns (TokenConfig memory) {
    return getTokenConfig(tokenBySymbol[symbol_]);
  }
}
