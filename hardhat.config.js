require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-etherscan');
require('solidity-coverage');
require('hardhat-contract-sizer');
require('hardhat-gas-reporter');
require('hardhat-typechain');

require('./tasks/fetchPairValues')
require('./tasks/deployTestnet')
require('./tasks/deployMainnet')
require('./tasks/deployInstantUniswapPrice')
require('./tasks/redeployOracleImplementation')


const fs = require('fs');
const homeDir = require('os').homedir();
const _ = require('lodash');

function getAccounts(network) {
  const fileName = homeDir + '/.ethereum/' + network;
  if(!fs.existsSync(fileName)) {
    return [];
  }
  return [_.trim('0x' + fs.readFileSync(fileName, {encoding: 'utf8'}))];
}

const gasLimit = 12 * 10 ** 6;

const config = {
  analytics: {
    enabled: false,
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: true,
  },
  // defaultNetwork: 'buidlerevm',
  gasReporter: {
    currency: 'USD',
    enabled: !!(process.env.REPORT_GAS)
  },
  mocha: {
    timeout: 20000
  },
  networks: {
    hardhat: {
      gas: gasLimit,
      blockGasLimit: gasLimit,
      allowUnlimitedContractSize: true
    },
    mainnet: {
      url: 'https://mainnet-eth.compound.finance',
      gasPrice: 81 * 10 ** 9,
      gasMultiplier: 1.5,
      accounts: getAccounts('mainnet'),
      gas: gasLimit,
      blockGasLimit: gasLimit
    },
    kovan: {
      url: 'https://kovan-eth.compound.finance',
      gasPrice: 10 ** 9,
      gasMultiplier: 1.5,
      accounts: getAccounts('kovan'),
      gas: gasLimit,
      blockGasLimit: gasLimit
    },
    mainnetfork: {
      url: 'http://127.0.0.1:8545/',
      // accounts: getAccounts('mainnet'),
      gasPrice: 150 * 10 ** 9,
      gasMultiplier: 1.5,
      timeout: 2000000,
      gas: gasLimit,
      blockGasLimit: gasLimit,
    },
    local: {
      url: 'http://127.0.0.1:8545',
    },
    coverage: {
      url: 'http://127.0.0.1:8555',
    },
  },
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    coverage: './coverage',
    coverageJson: './coverage.json',
    root: './',
    sources: './contracts',
    tests: './test',
  },
  solidity: {
    settings: {
      optimizer: {
        enabled: !!process.env.ETHERSCAN_KEY || process.env.COMPILE_TARGET === 'release',
        runs: 200,
      }
    },
    version: '0.6.12'
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
    runOnCompile: false
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY
  }
};

module.exports = config;
