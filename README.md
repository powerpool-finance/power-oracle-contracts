# Power Oracle Contracts

[![Actions Status](https://github.com/powerpool-finance/power-oracle-contracts/workflows/CI/badge.svg)](https://github.com/powerpool-finance/power-oracle-contracts/actions)

Power Oracle is a decentralized cross-chain price oracle working on Ethereum Main Network and sidechains. Power Oracle uses Uniswap V2 as its primary source of time-weighted average prices (TWAPs) and introduces economic incentives for independent price reporters.

🚨 **Security review status: unaudited**

## Contracts on Ethereum Main Network
### Active
- `PowerOracle`(ProxyAdmin - [0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb](https://etherscan.io/address/0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb#code), Proxy - [0x50f8D7f4db16AA926497993F020364f739EDb988](https://etherscan.io/address/0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB#code), Implementation - [0xf0d67691dA5aD3813Aaf412756d61f0f4390c6d2](https://etherscan.io/address/0xf0d67691dA5aD3813Aaf412756d61f0f4390c6d2)).
- `PowerPoke`(ProxyAdmin - [0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb](https://etherscan.io/address/0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb#code), Proxy - [0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96](https://etherscan.io/address/0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B960x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96#code), Implementation - [0xfE53Ad2c2085636FEBC20a9F06a0826659a5b059](https://etherscan.io/address/0xfE53Ad2c2085636FEBC20a9F06a0826659a5b059)).
- `PowerPokeStaking`(ProxyAdmin - [0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb](https://etherscan.io/address/0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb#code), Proxy - [0x646E846b6eE143bDe4F329d4165929bbdcf425f5](https://etherscan.io/address/0x646E846b6eE143bDe4F329d4165929bbdcf425f5#code), Implementation - [0xc0Cd319c0066733C611fb9a8BD5f2A1c38EB74B2](https://etherscan.io/address/0xc0Cd319c0066733C611fb9a8BD5f2A1c38EB74B2)).

### Deprecated
- `PowerOracle`(Implementation - [0xA394922A1A45786583e5383cf4485a6F325d8807](https://etherscan.io/address/0xA394922A1A45786583e5383cf4485a6F325d8807)). Previous implementation;
- `PowerOracle`(Implementation - [0x4b6E556841a88B0682c0bc9AbB6bdAF4572184b4](https://etherscan.io/address/0x4b6E556841a88B0682c0bc9AbB6bdAF4572184b4)). Previous implementation;
- `PowerOracle`(Implementation - [0x3359Bb31CD8F80a98a13856d3C89b71e7b51a0F0](https://etherscan.io/address/0x3359Bb31CD8F80a98a13856d3C89b71e7b51a0F0)). Previous implementation;
- `PowerOracle`(Proxy - [0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB](https://etherscan.io/address/0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB)). Previous Proxy;

## Contracts on Kovan Test Network

## Testing and Development

Use `yarn` or `npm` to run the following npm tasks:

- `yarn compile` - compile contracts
- `yarn test` - run tests
- `yarn coverage` - generate test coverage report
