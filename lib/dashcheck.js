"use strict";

let Base58Check = require("@root/base58check").Base58Check;

let DashTypes = {
  name: "dash",
  pubKeyHashVersion: "4c",
  privateKeyVersion: "cc",
  coinType: "5",
};

let b58c = Base58Check.create({
  pubKeyHashVersion: DashTypes.pubKeyHashVersion,
  privateKeyVersion: DashTypes.privateKeyVersion,
});

module.exports = b58c;
