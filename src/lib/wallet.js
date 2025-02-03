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

const { EventEmitter } = require('events')
const AssetList = require('./asset-list.js')
const { randomBytes } = require('crypto')
const defaultWallet = require('../modules/default-wallet.js')

async function exportAssetParser (data, fns) {
  const { libs, tokens, defaultConfig } = defaultWallet
  let assets = []
  if (!data || !data.assets || data.assets.length === 0) {
    for (const key of libs) {
      const tokns = tokens[key]
      const base = defaultConfig[key]

      const opts = { ...data, tokenConfig: tokns, name: base.name }
      const mod = await fns[key](opts)
      assets.push(mod)
    }
  } else {
    assets = await Promise.all(data.assets.map((asset) => {
      if (!fns[asset.module]) return null
      const mod = fns[asset.module](asset, data)
      return mod
    }))
  }
  return assets.filter(Boolean)
}

const WalletError = Error

class Wallet extends EventEmitter {
  constructor (config) {
    super()
    if (!config.store) throw new WalletError('Store not provided', 'BAD_ARGS')
    if (!config.seed) throw new WalletError('Seed not provided', 'BAD_ARGS')
    if (!Array.isArray(config.assets)) throw new WalletError('Assets must be an array', 'BAD_ARGS')
    this.seed = config.seed
    this.store = config.store
    this._assets = config.assets
    this.walletName = config.name || randomBytes(32).toString('hex')
  }

  async initialize () {
    this.pay = new AssetList()
    await Promise.all(this._assets.map((asset) => {
      return this._initAsset(asset)
    }))
    this._assets = null
    this.emit('ready')
  }

  async _initAsset (asset) {
    try {
      await asset.initialize({ wallet: this })
      asset.on('new-tx', (tx) => {
        this.emit('new-tx', asset.assetName, tx)
      })
    } catch (err) {
      console.log(err)
    }
  }

  async destroy () {
    await this.pay.each(asset => asset.destroy())
    this.seed = null
    await this.store.close()
    this.store = null
    this.pay = null
  }

  async addAsset (k, assetObj) {
    if (typeof k !== 'string') {
      return this._initAsset(k)
    }
    this.pay.set(k, assetObj)
  }

  async _sync (opts, asset) {
    const tokens = asset.getTokens()
    await asset.syncTransactions(opts)
    this.emit('asset-synced', asset.assetName)

    for (const [token] of tokens) {
      await asset.syncTransactions({ ...opts, token })
      this.emit('asset-synced', asset.assetName, token)
    }
  }

  async syncHistory (opts = {}) {
    if (opts.asset) {
      const asset = this.pay[opts.asset]
      if (!asset) throw new Error('asset does not exist')
      return this._sync(opts, asset)
    }
    return await this.pay.each(async (asset) => {
      return this._sync(opts, asset)
    })
  }

  exportSeed () {
    return this.seed.exportSeed()
  }

  async exportWallet () {
    const exportAsset = await this.pay.each(async (asset, key) => {
      const tokens = asset.getTokens()
      let tokenInstance, tokenConfig, tokenKeys
      if (tokens.size > 0) {
        tokenKeys = Array.from(tokens.keys())
        tokenInstance = tokens.get(tokenKeys[0]).constructor.name
        tokenConfig = tokenKeys.map((k) => {
          const token = tokens.get(k)
          return token.Currency.exportConfig()
        })
      }
      const modInfo = await asset._getModuleInfo()
      const endpoints = asset.getProviderEndpoint()

      return {
        name: key,
        module: modInfo.name,
        moduleVersion: modInfo.version,
        network: asset.network,
        endpoints,
        tokenKeys,
        tokenInstance,
        tokenConfig
      }
    })

    const seed = {
      module: this.seed.constructor.name,
      ...this.seed.exportSeed({ string: false })
    }

    const assets = []
    const exportErrors = []
    const assetKeys = this.pay.keys
    exportAsset.forEach((exp) => {
      if (exp.value) return assets.push(exp.value)
      if (exp.reason) return exportErrors.push(exp.reason)
    })

    return {
      store_path: this.store.store_path,
      name: this.walletName,
      seed,
      assets,
      assetKeys,
      exportErrors
    }
  }

  static exportAssetParser (walletExport, setupFn) {
    return exportAssetParser(walletExport, setupFn)
  }
}

module.exports = Wallet
