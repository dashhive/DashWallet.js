# wallet.js

A more civilized wallet for a less civilized age...

```sh
wallet send @johndoe 1.0
```

```txt
Sent Đ1.0 to @johndoe!
```

# CLI (not version-locked)

```txt
dashwallet v0.2.1 - A more civilized wallet for a less civilized age

USAGE:
    wallet <subcommand> [flags] [options] [--] [args]

SUBCOMMANDS:
    accounts                           show accounts (and extra wallets)
    export <addr> [./dir/ or x.wif]    write private keys to disk
    contact <handle> [xpub-or-addr]    add contact or show xpubs & addrs
    generate address                   gen and store one-off wif
    import <./path/to.wif>             save private keys
    coins [--sort wallet,amount,addr]  show all spendable coins
    send <handle|pay-addr> <DASH>      send to an address or contact
                    [--dry-run] [--coins Xxxxx:xx:0,...]
    remove <addr> [--no-wif]           remove stand-alone key
    stat <addr>                        show current coins & balance
    sync                               update address caches
    version                            show version and exit

OPTIONS:
    DASH_ENV, -c, --config-name ''     use ~/.config/dash{.suffix}/
    --config-dir ~/.config/dash/       change full config path
    --json                             output as JSON (if possible)
    --sync                             wait for sync first
```

## Examples

```sh
# wallet contact <handle> [xpub-or-addr]
wallet contact @kraken 'Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

```txt
Send DASH to '<handle>' at this address:
Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

Share this address with '<handle>':
xpubXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

# Alpha API (may change)

# Wallet.create(config)

Creates a wallet instance with the given config

- [DashSight](https://github.com/dashhive/dashsight.js) adapter - or any
  interface matching:
  - `getTxs(addr, page)`
  - `getUtxos(addr)`
  - `instantSend(txHex)`
- `safe`
  - `wallets`
  - `addresses`
- Storage adapter
  - `save()` storage adapter (and "safe").

```js
let w = await Wallet.create({ storage, safe, dashsight });
```

# Wallet.generate(walletInfo)

Generates a complete `PrivateWallet` object.

```js
Wallet.generate({
  name: "main",
  label: "Main",
  priority: 1, // lower sorts higher
});
```

```json
{
  "name": "main",
  "label": "Main",
  "device": null,
  "contact": null,
  "priority": 1,
  "mnemonic": ["twelve", "words"],
  "created_at": "2022-02-22T22:02:22.000Z",
  "archived_at": null
}
```

# Wallet.generateAddress(addrInfo)

Generates a complete `addrInfo` object.

```js
Wallet.generateAddress({
  wallet: "main",
  hdpath: "m/44'/5'/0'/0",
  index: 0,
});
```

```json
{
  "checked_at": 0,
  "hdpath": "m/44'/5'/0'/0",
  "index": 0,
  "txs": [],
  "utxos": [],
  "wallet": "main"
}
```

# Wallet.generatePayWallet(walletInfo)

Generates a complete `PayWallet` object.

```json
{
  "name": "@johndoe",
  "label": "@johndoe",
  "device": null,
  "contact": "@johndoe",
  "priority": 1668919000655,
  "xpub": "xpubXXXX...XXXX",
  "addr": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "created_at": "2022-02-22T22:02:22.000Z",
  "archived_at": null
}
```

# Wallet#balances()

Show spendable duffs / satoshis per each wallet.

You may need to `await wallet.sync()` first.

```js
await wallet.balances();
```

```json
{
  "main": 1212000,
  "@johndoe:1": 120000
}
```

# Wallet#befriend(friendDetails)

Generate or show an `xpub` for your contact, and import their xpub for you, if
any.

```js
await wallet.befriend({
  handle: "@johndoe",
  // optional (either or, not both)
  xpub: "<the-xpub-that-john-doe-gave-to-you>",
  addr: "<a-static-pay-addr-from-john-doe>",
});
```

```json
["<xpub-YOU-should-give-to-john>", "xpub-JOHN-gave-to-you", "addr-from-JOHN"]
```

# wallet.createTx(txOpts)

Creates a transaction (hex string) for the given amount to the given contact
using `utxo`s from across all `PrivateWallet`s.

```js
await wallet.createTx({ handle, amount, utxos });
```

```json
{
  "hex": "abc123...",
  "utxos": [
    {
      "address": "...",
      "outputIndex": 0,
      "satoshis": 1000,
      "script": "...",
      "txId": "..."
    }
  ]
}
```

The result can be used with `dashsight.instantSend(tx.hex)`.

# wallet#findChangeWallet(friendOpts)

Finds your `PrivateWallet` for the given contact.

```js
await wallet.findChangeWallet({ handle: "@johndoe" });
```

Returns a `PrivateWallet`, as described above.

# wallet#findFriend(friendOpts)

Finds the xpub-only (pay-to, send-only) wallet for the given contact.

```js
await wallet.findFriend({ handle: "@johndoe" });
```

Returns a `PayWallet`, as described above.

# wallet#nextChangeAddr(friendOpts)

Find the next unused change address for the `PrivateWallet` associated with the
given contact, or from the `main` wallet as a fallback.

```js
await wallet.nextChangAddr({ handle: "@johndoe" });
```

Returns a PayAddr.

```js
"Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
```

# Wallet#sync(syncOpts)

(Re)index addresses for each wallet and fetch latest transactions for the next
few addresses.

```js
let now = Date.now();
let staletime = 60 * 1000; // 0 to force immediate sync
await wallet.sync({ now, staletime });
```

# Wallet#utxos()

Get _all_ utxos across all `PrivateWallet`s.

```js
await wallet.utxos();
```

The results are in dashcore/bitcore format:

```json
[
 txId: '<hex-tx-id>',
 outputIndex: 0,
 address: "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 script: 'xxxx...',
 satoshis: 100000000
]
```

There's no response, just updates to `safe.addresses`, and `store.save()` will
be called.
