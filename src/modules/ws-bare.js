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
const { Socket } = require('bare-ws')

class BareWs extends EventEmitter {
  constructor (url, cb) {
    super()
    const client = new Socket(url)

    client.on('data', (data) => {
      this.emit('data', data)
    })
    client.on('error', (data) => {
      this.emit('error', data)
    })
    client.on('close', (data) => {
      this.emit('close', data)
    })

    setTimeout(() => {
      this.emit('open')
    }, 3000)
    this._ws = client
  }

  write (data) {
    this._ws.write(data)
  }

  end () {
    this._ws.end()
  }

  close () {
    this._ws.end()
  }
}

module.exports = BareWs
