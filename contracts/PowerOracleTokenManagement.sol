// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./interfaces/IPowerOracleV3TokenManagement.sol";
import "./PowerOracleStorageV1.sol";
import "./utils/PowerOwnable.sol";

abstract contract PowerOracleTokenManagement is IPowerOracleV3TokenManagement, PowerOwnable, PowerOracleStorageV1 {
  uint8 internal constant TOKEN_ACTIVITY_NOT_EXISTS = 0;
  uint8 internal constant TOKEN_ACTIVITY_DEPRECATED = 1;
  uint8 internal constant TOKEN_ACTIVITY_ACTIVE = 2;

  event AddToken(
    address indexed token,
    bytes32 indexed symbolHash,
    string symbol,
    uint96 baseUnit,
    uint96 fixedPrice,
    uint8 priceSource,
    address uniswapMarket,
    bool isUniswapReversed
  );
  event UpdateTokenMarket(address indexed token, address indexed uniswapMarket, bool isUniswapReversed);
  event SetTokenActivity(address indexed token, uint8 active);

  /// @notice Required only for the setup function, not persisted in the storage
  struct TokenConfigSetup {
    address token;
    string symbol;
    TokenConfig basic;
    TokenConfigUpdate update;
  }

  /// @notice Required only for the setup function, not persisted in the storage
  struct TokenConfigUpdateSetup {
    address token;
    TokenConfigUpdate update;
  }

  /// @notice Required only for the setup function, not persisted in the storage
  struct TokenActivitySetup {
    address token;
    uint8 active;
  }

  function addTokens(TokenConfigSetup[] memory setup_) external onlyOwner {
    uint256 len = setup_.length;

    for (uint256 i = 0; i < len; i++) {
      TokenConfigSetup memory tc = setup_[i];
      address token = tc.token;

      require(tc.basic.symbolHash == keccak256(abi.encodePacked(tc.symbol)), "INVALID_SYMBOL_HASH");
      require(tokenConfigs[token].active == TOKEN_ACTIVITY_NOT_EXISTS, "ALREADY_EXISTS");
      require(tc.basic.baseUnit > 0, "BASE_UNIT_IS_NULL");
      require(tc.basic.active > 0 && tc.basic.active <= 2, "INVALID_ACTIVITY_STATUS");
      require(tc.basic.priceSource <= 1, "INVALID_PRICE_SOURCE");
      require(tokenBySymbolHash[tc.basic.symbolHash] == address(0), "TOKEN_SYMBOL_ALREADY_MAPPED");

      tokenConfigs[token] = setup_[i].basic;
      tokenUpdateConfigs[token] = setup_[i].update;

      tokenBySymbol[tc.symbol] = token;
      tokenBySymbolHash[tc.basic.symbolHash] = token;

      tokens.push(token);

      emit AddToken(
        token,
        tc.basic.symbolHash,
        tc.symbol,
        tc.basic.baseUnit,
        tc.basic.fixedPrice,
        tc.basic.priceSource,
        tc.update.uniswapMarket,
        tc.update.isUniswapReversed
      );
    }
  }

  function updateTokenMarket(TokenConfigUpdateSetup[] memory setup_) external onlyOwner {
    uint256 len = setup_.length;

    for (uint256 i = 0; i < len; i++) {
      address token = setup_[i].token;
      require(tokenConfigs[token].active > 0 && tokenConfigs[token].active <= 2, "INVALID_ACTIVITY_STATUS");

      tokenUpdateConfigs[token] = setup_[i].update;
      emit UpdateTokenMarket(token, setup_[i].update.uniswapMarket, setup_[i].update.isUniswapReversed);
    }
  }

  function setTokenActivities(TokenActivitySetup[] calldata setup_) external onlyOwner {
    uint256 len = setup_.length;

    for (uint256 i = 0; i < len; i++) {
      address token = setup_[i].token;
      uint8 tokenActivity = setup_[i].active;

      require(tokenConfigs[token].active > 0, "INVALID_CURRENT_ACTIVITY_STATUS");
      require(tokenActivity > 0 && tokenActivity <= 2, "INVALID_NEW_ACTIVITY_STATUS");

      tokenConfigs[token].active = tokenActivity;
      emit SetTokenActivity(token, tokenActivity);
    }
  }

  function getTokenUpdateConfig(address token_) public view returns (TokenConfigUpdate memory) {
    return tokenUpdateConfigs[token_];
  }

  function getTokenConfig(address token_) public view returns (TokenConfig memory) {
    return tokenConfigs[token_];
  }

  function getActiveTokenConfig(address token_) public view returns (TokenConfig memory) {
    TokenConfig memory cfg = tokenConfigs[token_];
    require(token_ != address(0) && cfg.active == TOKEN_ACTIVITY_ACTIVE, "TOKEN_NOT_FOUND");
    return cfg;
  }

  function getTokenConfigBySymbolHash(bytes32 symbolHash_) public view returns (TokenConfig memory) {
    return getActiveTokenConfig(tokenBySymbolHash[symbolHash_]);
  }

  function getTokenConfigBySymbol(string memory symbol_) public view returns (TokenConfig memory) {
    return getActiveTokenConfig(tokenBySymbol[symbol_]);
  }

  function getTokens() external view override returns (address[] memory) {
    return tokens;
  }

  function getTokenCount() external view override returns (uint256) {
    return tokens.length;
  }
}
