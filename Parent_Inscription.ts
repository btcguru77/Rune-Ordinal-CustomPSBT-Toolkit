import {
  Transaction,
  script,
  Psbt,
  initEccLib,
  networks,
  Signer as BTCSigner,
  crypto,
  payments,
  opcodes,
  address as Address
} from "bitcoinjs-lib";

import { Taptree } from "bitcoinjs-lib/src/types";
import { ECPairFactory, ECPairAPI } from "ecpair";
import ecc from "@bitcoinerlab/secp256k1";
import axios, { AxiosResponse } from "axios";
import networkConfig from "config/network.config";
import { WIFWallet } from 'utils/WIFWallet'
import { SeedWallet } from "utils/SeedWallet";
import cbor from 'cbor'
import { sendUTXO } from "Custom_UTXO";
import { getCurrentFeeRate, getUtxos } from "utils/mempool";
//test
const network = networks.testnet;
// const network = networks.bitcoin;

initEccLib(ecc as any);
const ECPair: ECPairAPI = ECPairFactory(ecc);

// const seed: string = process.env.MNEMONIC as string;
// const networkType: string = networkConfig.networkType;
// const wallet = new SeedWallet({ networkType: networkType, seed: seed });

export const contentBuffer = (content: string) => {
  return Buffer.from(content, 'utf8')
}

const privateKey: string = process.env.PRIVATE_KEY as string;
const networkType: string = networkConfig.networkType;
const wallet = new WIFWallet({ networkType: networkType, privateKey: privateKey });

const receiveAddress: string = "tb1p5yjm3fkr6n4rumfjm5c5rsu7c9uc4av847p0cu2n8vfdv05pph9smdjrt3";
const metadata = {
  'type': 'Testing Parent',
  'description': 'Testing Parent Ordinal'
}
const metadataBuffer = cbor.encode(metadata);

// Temp txid
const tempTxid = "9cf36d8d8db735417828b315499696f113eb44a6ad0cfce045bb65f8e3760b5e";
const tempTxid1 = "80ea6c9c2a266cf7cf52265b46d8399c7659d66e42f827ae6010e777ef3099bd";
const tempVout = 0;

const tempUtxo = {
  txid: tempTxid,
  vout: 0,
  value: 546
}

const tempUtxo1 = {
  txid: tempTxid1,
  vout: 0,
  value: 546
}

const txidBuffer = Buffer.from(tempTxid, 'hex');
const inscriptionBuffer = txidBuffer.reverse();


const contentBufferData: Buffer = contentBuffer('0.364972.bitmap')

const splitBuffer = (buffer: Buffer, chunkSize: number) => {
  let chunks = [];
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const chunk = buffer.subarray(i, i + chunkSize);
    chunks.push(chunk);
  }
  return chunks;
};

const contentBufferArray: Array<Buffer> = splitBuffer(contentBufferData, 400)

export const getVirtulByte = async (redeem: any, ordinal_p2tr: any) => {

  const keyPair = wallet.ecPair;

  let psbt = new Psbt({
    network: networkType == "testnet" ? networks.testnet : networks.bitcoin
  });

  psbt.addInput({
    hash: tempUtxo.txid,
    index: tempUtxo.vout,
    tapInternalKey: toXOnly(keyPair.publicKey),
    witnessUtxo: { value: tempUtxo.value, script: ordinal_p2tr.output! },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: ordinal_p2tr.witness![ordinal_p2tr.witness!.length - 1],
      },
    ],
  });

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: 546,
  });

  try {
    psbt = wallet.signSpecPsbt(psbt, wallet.ecPair)
    return psbt.extractTransaction().virtualSize();
  } catch (error) {
    console.log("getting virtualsize error => ", error)
    return 0;
  }

}

export const getChildVirtulByte = async (redeem: any, ordinal_p2tr: any) => {

  const keyPair = wallet.ecPair;

  let psbt = new Psbt({
    network: networkType == "testnet" ? networks.testnet : networks.bitcoin
  });

  psbt.addInput({
    hash: tempUtxo1.txid,
    index: tempUtxo1.vout,
    witnessUtxo: {
      value: tempUtxo1.value,
      script: wallet.output,
    },
    tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
  });

  psbt.addInput({
    hash: tempUtxo.txid,
    index: tempUtxo.vout,
    tapInternalKey: toXOnly(keyPair.publicKey),
    witnessUtxo: { value: tempUtxo.value, script: ordinal_p2tr.output! },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: ordinal_p2tr.witness![ordinal_p2tr.witness!.length - 1],
      },
    ],
  });

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: 546,
  });

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: 546,
  });

  try {
    const signer = tweakSigner(wallet.ecPair, { network })
    psbt.signInput(0, signer);
    psbt.signInput(1, wallet.ecPair);
    psbt.finalizeAllInputs()
    return psbt.extractTransaction().virtualSize();
  } catch (error) {
    console.log("getting virtualsize error => ", error)
    return 0;
  }

}

export const getFeeForSimplePsbt = async (utxo: any) => {
  let psbt = new Psbt({
    network: networkType == "testnet" ? networks.testnet : networks.bitcoin
  });

  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      value: utxo.value,
      script: wallet.output,
    },
    tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
  })
  psbt.addOutput({
    address: wallet.address,
    value: utxo.value,
  })

  try {
    psbt = wallet.signPsbt(psbt, wallet.ecPair)
    return psbt.extractTransaction().virtualSize();
  } catch (error) {
    console.log("getting virtualsize error => ", error)
    return 0;
  }
}

export const getChildFeeSimplePsbt = async (utxo: any, parentUtxo: any) => {
  console.log("new ordinal child utxo => ", utxo)
  let psbt = new Psbt({
    network: networkType == "testnet" ? networks.testnet : networks.bitcoin
  });

  psbt.addInput({
    hash: parentUtxo.txid,
    index: parentUtxo.vout,
    witnessUtxo: {
      value: parentUtxo.value,
      script: wallet.output,
    },
    tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
  })
  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      value: utxo.value,
      script: wallet.output,
    },
    tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
  })
  psbt.addOutput({
    address: wallet.address,
    value: parentUtxo.value,
  });
  psbt.addOutput({
    address: wallet.address,
    value: utxo.value,
  });

  try {
    psbt = wallet.signPsbt(psbt, wallet.ecPair)
    return psbt.extractTransaction().virtualSize();
  } catch (error) {
    console.log("getting virtualsize error => ", error)
    return 0;
  }
}

export const getParentUtxo = async (UTXOs: any[]) => {
  const parentUtxo = UTXOs.find((utxo: any) => {
    return utxo.txid.toUpperCase() === tempTxid.toUpperCase()
  })
  return parentUtxo
}


export function createparentInscriptionTapScript(): Array<Buffer> {
  const keyPair = wallet.ecPair;
  const parentOrdinalStacks: any = [
    toXOnly(keyPair.publicKey),
    opcodes.OP_CHECKSIG,
    opcodes.OP_FALSE,
    opcodes.OP_IF,
    Buffer.from("ord", "utf8"),
    1,
    1,
    Buffer.concat([Buffer.from("text/plain;charset=utf-8", "utf8")]),
    1,
    5,
    metadataBuffer,
    opcodes.OP_0,
    Buffer.concat([Buffer.from("364972.bitmap", "utf8")]),
    opcodes.OP_ENDIF,
  ];
  return parentOrdinalStacks;
}

const inscriptions = [
  {
    mimeType: "text/plain;charset=utf-8",
    content: Buffer.from("first child", "utf8"),
    filename: "first child inscription"
  }
];

export function createchildInscriptionTapScript(): Array<Buffer> {
  const keyPair = wallet.ecPair;
  const parentOrdinalStacks: any = [
    toXOnly(keyPair.publicKey),
    opcodes.OP_CHECKSIG,
  ];

  // inscriptions.forEach((inscription, index) => {
  parentOrdinalStacks.push(
    opcodes.OP_FALSE,
    opcodes.OP_IF,
    Buffer.from("ord", "utf8"),
    1,
    1,
    Buffer.concat([Buffer.from(inscriptions[0].mimeType, "utf8")]),
    1,
    2,
    Buffer.from((546).toString(16).padStart(4, '0'), 'hex').reverse(),
    1,
    3,
    inscriptionBuffer,
    1,
    5,
    inscriptions[0].content,
    opcodes.OP_0,
  );

  contentBufferArray.forEach((item: Buffer) => {
    parentOrdinalStacks.push(item)
  })
  parentOrdinalStacks.push(opcodes.OP_ENDIF)
  // });

  return parentOrdinalStacks;
}

export async function parentInscribe() {
  const keyPair = wallet.ecPair;
  const parentOrdinalStack = createparentInscriptionTapScript();

  const ordinal_script = script.compile(parentOrdinalStack);

  const scriptTree: Taptree = {
    output: ordinal_script,
  };

  const redeem = {
    output: ordinal_script,
    redeemVersion: 192,
  };

  const ordinal_p2tr = payments.p2tr({
    internalPubkey: toXOnly(keyPair.publicKey),
    network,
    scriptTree,
    redeem,
  });

  const address = ordinal_p2tr.address ?? "";
  console.log("send coin to address", address);
  const currentFeeRate = await getCurrentFeeRate();
  const virtualSize = await getVirtulByte(redeem, ordinal_p2tr);
  const allUtxos = await getUtxos(wallet.address, networkType);
  const simplePsbt = await getFeeForSimplePsbt(allUtxos[0])
  if (!virtualSize || !simplePsbt) return console.log("Invaid psbt")

  console.log("needed fee => ", currentFeeRate * virtualSize)

  await sendUTXO(currentFeeRate, currentFeeRate * virtualSize + 546 + 546, address);

  const utxos = await waitUntilUTXO(address as string);

  const psbt = new Psbt({ network });

  psbt.addInput({
    hash: utxos[utxos.length - 1].txid,
    index: utxos[utxos.length - 1].vout,
    tapInternalKey: toXOnly(keyPair.publicKey),
    witnessUtxo: { value: utxos[utxos.length - 1].value, script: ordinal_p2tr.output! },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: ordinal_p2tr.witness![ordinal_p2tr.witness!.length - 1],
      },
    ],
  });

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: 546,
  });

  await signAndSend(keyPair, psbt);
}

export async function childInscribe() {
  const keyPair = wallet.ecPair;
  const parentOrdinalStack = createchildInscriptionTapScript();

  const ordinal_script = script.compile(parentOrdinalStack);

  const scriptTree: Taptree = {
    output: ordinal_script,
  };

  const redeem = {
    output: ordinal_script,
    redeemVersion: 192,
  };

  const ordinal_p2tr = payments.p2tr({
    internalPubkey: toXOnly(keyPair.publicKey),
    network,
    scriptTree,
    redeem,
  });

  const address = ordinal_p2tr.address ?? "";
  console.log("send coin to address", address);
  const currentFeeRate = 10;
  console.log("🚀 ~ childInscribe ~ currentFeeRate:", currentFeeRate)
  const virtualSize = await getChildVirtulByte(redeem, ordinal_p2tr);
  console.log("🚀 ~ childInscribe ~ virtualSize:", virtualSize)
  const allUtxos = await getUtxos(wallet.address, networkType);
  console.log("🚀 ~ childInscribe ~ allUtxos:", allUtxos)
  const parentUtxo = await getParentUtxo(allUtxos);
  console.log("🚀 ~ childInscribe ~ parentUtxo:", parentUtxo)
  if (!parentUtxo) return console.log("This utxo does not exist!")
  const simplePsbt = await getChildFeeSimplePsbt(tempUtxo1, parentUtxo)
  console.log("🚀 ~ childInscribe ~ simplePsbt:", simplePsbt)
  if (!virtualSize || !simplePsbt) return console.log("Invaid psbt")

  console.log("needed fee => ", currentFeeRate * virtualSize)

  await sendUTXO(currentFeeRate, currentFeeRate * virtualSize + 546, address);

  const utxos = await waitUntilUTXO(address as string);
  console.log("🚀 ~ childInscribe ~ utxos:", utxos)

  const psbt = new Psbt({ network });

  psbt.addInput({
    hash: parentUtxo.txid,
    index: parentUtxo.vout,
    witnessUtxo: {
      value: parentUtxo.value,
      script: wallet.output,
    },
    tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
  });

  console.log("child utxo => ", utxos[utxos.length - 1]);

  psbt.addInput({
    hash: utxos[utxos.length - 1].txid,
    index: utxos[utxos.length - 1].vout,
    tapInternalKey: toXOnly(keyPair.publicKey),
    witnessUtxo: { value: utxos[utxos.length - 1].value, script: ordinal_p2tr.output! },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: ordinal_p2tr.witness![ordinal_p2tr.witness!.length - 1],
      },
    ],
  });

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: 546,
  });

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: 546,
  });

  await signAndSend(keyPair, psbt);
}

childInscribe()

export async function signAndSend(
  keypair: BTCSigner,
  psbt: Psbt,
) {
  const signer = tweakSigner(keypair, { network })
  psbt.signInput(0, signer);
  psbt.signInput(1, keypair);
  psbt.finalizeAllInputs()
  const tx = psbt.extractTransaction();

  console.log("tx.virtualSize => ", tx.virtualSize())
  console.log(tx.toHex())

  const txid = await broadcast(tx.toHex());
  console.log(`Success! Txid is ${txid}`);
}

export async function waitUntilUTXO(address: string) {
  return new Promise<IUTXO[]>((resolve, reject) => {
    let intervalId: any;
    const checkForUtxo = async () => {
      try {
        const response: AxiosResponse<string> = await blockstream.get(
          `/address/${address}/utxo`
        );
        const data: IUTXO[] = response.data
          ? JSON.parse(response.data)
          : undefined;
        console.log("wait untilutxo => ", data);
        if (data.length > 0) {
          resolve(data);
          clearInterval(intervalId);
        }
      } catch (error) {
        reject(error);
        clearInterval(intervalId);
      }
    };
    intervalId = setInterval(checkForUtxo, 4000);
  });
}

export async function getTx(id: string): Promise<string> {
  const response: AxiosResponse<string> = await blockstream.get(
    `/tx/${id}/hex`
  );
  return response.data;
}

const blockstream = new axios.Axios({
  baseURL: `https://mempool.space/testnet/api`,
  // baseURL: `https://mempool.space/api`,
});

export async function broadcast(txHex: string) {
  const response: AxiosResponse<string> = await blockstream.post("/tx", txHex);
  return response.data;
}

function tapTweakHash(pubKey: Buffer, h: Buffer | undefined): Buffer {
  return crypto.taggedHash(
    "TapTweak",
    Buffer.concat(h ? [pubKey, h] : [pubKey])
  );
}

function toXOnly(pubkey: Buffer): Buffer {
  return pubkey.subarray(1, 33);
}

function tweakSigner(signer: any, opts: any = {}) {
  let privateKey = signer.privateKey;
  if (!privateKey) {
    throw new Error('Private key is required for tweaking signer!');
  }
  if (signer.publicKey[0] === 3) {
    privateKey = ecc.privateNegate(privateKey);
  }
  const tweakedPrivateKey = ecc.privateAdd(privateKey, tapTweakHash(toXOnly(signer.publicKey), opts.tweakHash));
  if (!tweakedPrivateKey) {
    throw new Error('Invalid tweaked private key!');
  }
  return ECPair.fromPrivateKey(Buffer.from(tweakedPrivateKey), {
    network: opts.network,
  });
}

interface IUTXO {
  txid: string;
  vout: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
  value: number;
}