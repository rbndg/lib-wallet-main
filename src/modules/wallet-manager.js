const { WalletStoreHyperbee } = require('lib-wallet-store')

const MAX_SUB_SIZE = 10000

/**
 * @classdesc Manages multiple wallets, providing a unified interface for creating, loading, saving, and interacting with them.
 * Handles wallet persistence using a db store, manages event subscriptions across wallets, and provides a centralized method for calling methods on individual wallets.
 * Supports loading all wallets or specific wallets by name.
 */
class MultiWalletManager {
  constructor (opts, walletLoader) {
    this._store = new WalletStoreHyperbee({
      store_path: opts.store_path + '/wallet-manager'
    })
    this._store_path = opts.store_path
    this._wallets = new Map()
    this._walletLoader = walletLoader
    this._subs = new Map()
    if (!this._walletLoader) throw new Error('wallet loader must be passed')
  }

  async init () {
    await this._store.init()
  }

  async getWalletList () {
    return (await this._store.get('wallets')) || []
  }

  _updateWalletList (data) {
    return this._store.put('wallets', data)
  }

  getWallet (_, name) {
    return this._store.get(`wallet-${name}`)
  }

  async shutdown () {
    const res = []
    for (const [key, wallet] of this._wallets) {
      res.push(key)
      await wallet.destroy()
    }

    await this._store.close()
    this._wallets = new Map()

    return res
  }

  async resumeWallets () {
    for (const wallet of this._wallets) {
      await wallet[1].destroy()
    }
  }

  _runWalletLoader (walletExp) {
    return this._walletLoader(walletExp, {
      store_path: this._store_path
    })
  }

  async addWallet (req, walletExport) {
    const walletList = await this.getWalletList()
    if (walletList.includes(walletExport.name)) {
      throw new Error('wallet already exists')
    }
    walletList.push(walletExport.name)

    await this._store.put(`wallet-${walletExport.name}`, walletExport)
    await this._updateWalletList(walletList)
  }

  async removeWallet (req, name) {
    const walletList = await this.getWalletList()
    delete walletList[name]
    await this._updateWalletList(walletList)
  }

  async _load (config) {
    const walletExp = await this.getWallet({}, config.name)
    const wallet = await this._runWalletLoader(walletExp)
    this._wallets.set(config.name, wallet)
    return wallet
  }

  async loadWallet (opts, ...param) {
    const res = await this._setupWallet(...param)
    return res.map((w) => w.walletName)
  }

  async _setupWallet (opts) {
    const walletList = await this.getWalletList()
    if (opts.all) {
      await Promise.all(walletList.map(async (walletName) => {
        const config = await this.getWallet({}.walletName)
        await this._load(config)
      }))
      return walletList
    }
    const config = await this.getWallet({}, opts.name)
    if (!config) throw new Error('cant find wallet data')
    const wallet = await this._load(config)
    return [wallet]
  }

  async createWallet (req, opts = {}) {
    opts.name = opts.name || 'default'
    opts.store_path = opts.store_path || this._store_path
    let wallet = this._wallets.get(opts.name)
    if (wallet) throw new Error('wallet already exists with name')
    wallet = await this._runWalletLoader(opts)
    const walletExport = await wallet.exportWallet()
    this._wallets.set(wallet.walletName, wallet)
    await this.addWallet(req, walletExport)
    if (opts.req) {
      this._subBootstrapEvents(wallet, opts.req)
    }
    return walletExport
  }

  _subscribe (req, wallet, opts) {
    const eventName = this._getEventName(req)
    let eventKey

    if (this._subs.size === MAX_SUB_SIZE) throw new Error('memory leak: too many subscriptions')

    function eventHandler (...args) {
      try {
        req.notify(eventKey, [...args])
      } catch { }
    }

    if (opts === 'wallet') {
      eventKey = `${req.name}:${eventName}`
      wallet.on(eventName, eventHandler)
    } else if (opts === 'resource') {
      eventKey = `${req.name}:${req.namespace}-${req.resource}:${eventName}`
      wallet[req.namespace][req.resource].on(eventName, eventHandler)
    } else {
      throw new Error('invalid subscriptions opts')
    }

    this._subs.set(eventKey, eventHandler)

    return eventKey
  }

  _getEventName (req) {
    if (!Array.isArray(req.params)) throw new Error('req params must be an array')
    const eventName = req.params.shift()
    if (!eventName) throw new Error('event name is missing')
    return eventName
  }

  _getEventHandler (k) {
    const handler = this._subs.get(k)
    if (!handler) throw new Error('handler does not exist ' + k)
    return handler
  }

  _unsubscribe (req, wallet, opts) {
    let eventKey
    const eventName = this._getEventName(req)

    if (opts === 'wallet') {
      eventKey = `${req.name}:${eventName}`
      wallet.off(eventName, this._getEventHandler(eventKey))
    } else if (opts === 'resource') {
      eventKey = `${req.name}:${req.namespace}-${req.resource}:${eventName}`
      wallet[req.namespace][req.resource].off(eventName, this._getEventHandler(eventKey))
    } else {
      throw new Error('invalid unsub opts')
    }
    this._subs.delete(eventKey)
    return eventKey
  }

  _subBootstrapEvents (wallet, req) {
    const payEvents = this._walletLoader.bootstrapEvents.pay

    wallet.pay.each((asset, k) => {
      payEvents.forEach((ev) => {
        const eventKey = `${wallet.walletName}:pay-${k}:${ev}`
        asset.on(ev, (...args) => {
          req.notify(eventKey, [...args])
        })
      })
    })
  }

  async callWallet (req) {
    let wallet = this._wallets.get(req.name)
    if (!wallet) {
      wallet = await this._setupWallet({ name: req.name })
      if (!wallet || wallet.length === 0) throw new Error(`Wallet with name ${req.name} not found `)
      wallet = wallet.pop()
      this._subBootstrapEvents(wallet, req)
    }
    if (!wallet[req.namespace]) throw new Error('wallet doesnt have this namespace')

    if (req.namespace === 'on') {
      return this._subscribe(req, wallet, 'wallet')
    } else if (req.namespace === 'off') {
      return this._unsubscribe(req, wallet, 'wallet')
    }

    if (!req.resource) {
      return wallet[req.namespace](...req.params)
    }

    if (!wallet[req.namespace][req.resource]) throw new Error('wallet doesnt have this resource')

    if (req.method === 'on') {
      return this._subscribe(req, wallet, 'resource')
    } else if (req.method === 'off') {
      return this._unsubscribe(req, wallet, 'resource')
    }

    if (!wallet[req.namespace][req.resource][req.method]) throw new Error('wallet resource does not have that method name')

    if (Array.isArray(req.params)) {
      return wallet[req.namespace][req.resource][req.method](...req.params)
    }
    return wallet[req.namespace][req.resource][req.method](req.params)
  }
}

module.exports = MultiWalletManager
