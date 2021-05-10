// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IPowerOracleV2Reader {
  function getPriceByAsset(address token) external view returns (uint256);

  function getPriceBySymbol(string calldata symbol) external view returns (uint256);

  function getPriceBySymbolHash(bytes32 symbolHash) external view returns (uint256);

  function assetPrices(address token) external view returns (uint256);
}
