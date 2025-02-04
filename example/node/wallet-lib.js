'use strict'
// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
const Wallet = require('../../src/lib/wallet.js')

const { WalletStoreHyperbee } = require('lib-wallet-store')
const BIP39Seed = require('wallet-seed-bip39')
const { BitcoinPay } = require('lib-wallet-pay-btc')
const { EthPay } = require('lib-wallet-pay-eth')
const { Provider, ERC20 } = require('lib-wallet-pay-evm')
const { Erc20CurrencyFactory } = require('lib-wallet-util-evm')

/**
* this function is an example of how to setup various components of the wallet lib.
*/
async function main (config = {}) {
  const seed = await BIP39Seed.generate(config?.seed?.mnemonic)

  const store = new WalletStoreHyperbee({
    store_path: config.store_path
  })


  const btcPay = new BitcoinPay({
    // Asset name space
    asset_name: 'btc',
    // Asset's network
    network: config.network || 'regtest',
    electrum: {
      // optional TCP to Websocket adaptor. This will allow you to connect to a websocket electrum node
      net: require('../../src/modules/ws-net.js'),
      host: config.electrum_host,
      port: config.electrum_port
    }
  })

  const provider = new Provider({
    web3: config.web3,
    indexer: config.web3_indexer,
    indexerWs: config.web3_indexer_ws
  })
  await provider.connect()

  const USDT = Erc20CurrencyFactory({
    name: 'USDT',
    base_name: 'USDT',
    contract_address: config.token_contract || '0xdac17f958d2ee523a2206206994597c13d831ec7',
    decimal_places: 6
  })

  const ethPay = new EthPay({
    asset_name: 'eth',
    provider,
    store,
    network: config.network || 'regtest',
    token: [
      new ERC20({
        currency: USDT
      })
    ]
  })

  const wallet = new Wallet({
    store,
    seed,
    assets: [btcPay, ethPay]
  })

  await wallet.initialize()

  return wallet
}

module.exports = main
