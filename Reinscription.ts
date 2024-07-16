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
import { getCurrentFeeRate, getUtxos } from "utils/mempool";
//test
const network = networks.testnet;
// const network = networks.bitcoin;

initEccLib(ecc as any);
const ECPair: ECPairAPI = ECPairFactory(ecc);

// const seed: string = process.env.MNEMONIC as string;
// const networkType: string = networkConfig.networkType;
// const wallet = new SeedWallet({ networkType: networkType, seed: seed });

const privateKey: string = process.env.PRIVATE_KEY as string;
const networkType: string = networkConfig.networkType;
const wallet = new WIFWallet({ networkType: networkType, privateKey: privateKey });

const receiveAddress: string = "tb1pntrn45rwhrfv7dlqjjkw6keg7hex2zc598sekzdda3yzxfjstpfs4y8qcx";
const metadata = {
  'type': 'Reinscription',
  'description': 'Reinscription testing'
}

// get the info uding unisat api 
// https://open-api-testnet.unisat.io/v1/indexer/inscription/info/225ec6b10e805095451fd8b6068dd7cd190bf2a344d76d0e25520c3d3b40c199i0
const reinscriptionId = "f99f8f3ce05b56ac0868d24e1c029531c69df7b43351e93da0b04acca3fa8d7c";

const tempUtxo = {
  txid: reinscriptionId,
  vout: 0,
  value: 546
}

const metadataBuffer = cbor.encode(metadata);

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
    Buffer.concat([Buffer.from("reinscription.whistle.test", "utf8")]),
    opcodes.OP_ENDIF,
  ];
  return parentOrdinalStacks;
}

export const getEstimateFee = async (redeem: any, ordinal_p2tr: any) => {
  let psbt = new Psbt({ network });

  const currentFeeRate = await getCurrentFeeRate();

  psbt.addInput({
    hash: tempUtxo.txid,
    index: tempUtxo.vout,
    tapInternalKey: toXOnly(wallet.ecPair.publicKey),
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

  psbt = wallet.signSpecPsbt(psbt, wallet.ecPair)

  return currentFeeRate * psbt.extractTransaction().virtualSize();

}

export const getFeeforFeePsbt = async (utxos: any[]) => {
  const currentFeeRate = await getCurrentFeeRate()
  let psbt = new Psbt({ network });
  psbt.addInput({
    hash: utxos[0].txid,
    index: utxos[0].vout,
    witnessUtxo: {
      value: utxos[0].value,
      script: wallet.output,
    },
    tapInternalKey: toXOnly(wallet.ecPair.publicKey),
  });
  let totalAmount = 0;
  for (let i = 1; i < utxos.length; i++) {
    const utxo = utxos[i];
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        value: utxo.value,
        script: wallet.output,
      },
      tapInternalKey: toXOnly(wallet.ecPair.publicKey),
    });
    totalAmount += utxo.value
  }

  console.log("total amount => ", totalAmount)

  
  psbt.addOutput({
    address: wallet.address,
    value: 546
  })

  psbt.addOutput({
    address: receiveAddress, //Destination Address
    value: totalAmount - 1000,
  });

  psbt = wallet.signPsbt(psbt, wallet.ecPair);

  return currentFeeRate * psbt.extractTransaction().virtualSize();

}

// Get suitable utxos
export const getMinimalUtxos = async (UTXOs: any, totalBTC: number) => {
  // Sort the array in descending order
  UTXOs.sort((a: any, b: any) => b.value - a.value);

  let sum = 0;
  let result = [];
  // Traverse the array and keep adding elements until the sum is >= x
  for (let i = 0; i < UTXOs.length; i++) {
    sum += UTXOs[i].value;
    result.push(UTXOs[i]);
    if (sum >= totalBTC) {
      break;
    }
  }
  // If the sum is still less than x, return an empty array
  if (sum < totalBTC) {
    return { result: [], sum };
  }
  return { result, sum };
}

export const filterBtcUtxo = async (UTXOs: any) => {
  const utxos = UTXOs.filter((utxo: any) => {
    return utxo.value !== 546
  })
  return utxos
}

async function reInscribe() {
  const keyPair = wallet.ecPair;
  console.log("🚀 ~ reInscribe ~ keyPair:")
  const parentOrdinalStack = createparentInscriptionTapScript();
  console.log("🚀 ~ reInscribe ~ parentOrdinalStack:")

  const ordinal_script = script.compile(parentOrdinalStack);
  console.log("🚀 ~ reInscribe ~ ordinal_script:")

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
  console.log("Sending coin to address", address);

  const SendOrdinalsPsbt = new Psbt({ network });

  const sendOrdinalPsbtFee = await getEstimateFee(redeem, ordinal_p2tr);
  const currentFeeRate = await getCurrentFeeRate();
  console.log("🚀 ~ reInscribe ~ currentFeeRate:", currentFeeRate)
  const allUtxos = await getUtxos(wallet.address, networkType);
  const btcUtxos = await filterBtcUtxo(allUtxos);
  const feeUtxo = await getMinimalUtxos(btcUtxos, sendOrdinalPsbtFee + 546);

  const SendUtxos: Array<any> = [
    {
      txid: reinscriptionId,
      vout: 0,
      value: 546
    }
  ]

  for (let i = 0; i < feeUtxo.result.length; i++) {
    const utxo = feeUtxo.result[i];
    SendUtxos.push(utxo);
  }

  const feeForFeePsbt = await getFeeforFeePsbt(SendUtxos);

  SendOrdinalsPsbt.addInput({
    hash: SendUtxos[0].txid,
    index: 0,
    witnessUtxo: {
      value: 546,
      script: wallet.output,
    },
    tapInternalKey: toXOnly(wallet.ecPair.publicKey),
  });

  for (let i = 1; i < SendUtxos.length; i++) {
    const utxo = SendUtxos[i];

    SendOrdinalsPsbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        value: utxo.value,
        script: wallet.output,
      },
      tapInternalKey: toXOnly(wallet.ecPair.publicKey),
    });
  }


  SendOrdinalsPsbt.addOutput({
    address: address, //Destination Address
    value: 546 + sendOrdinalPsbtFee
  })

  SendOrdinalsPsbt.addOutput({
    address: wallet.address, 
    value: feeUtxo.sum - feeForFeePsbt - sendOrdinalPsbtFee,
  });

  await SendUtxoSignAndSend(keyPair, SendOrdinalsPsbt);

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

  const txid = await signAndSend(keyPair, psbt);
  console.log("🚀 ~ reInscribe ~ txid:", txid)
}

reInscribe()

export async function signAndSend(
  keypair: BTCSigner,
  psbt: Psbt,
) {
  psbt.signInput(0, keypair);
  psbt.finalizeAllInputs()
  const tx = psbt.extractTransaction();

  console.log(tx.virtualSize())
  console.log(tx.toHex())

  const txid = await broadcast(tx.toHex());
  return txid
}

export async function SendUtxoSignAndSend(
  keypair: BTCSigner,
  psbt: Psbt,
) {
  const signer = tweakSigner(keypair, { network })
  console.log('send utxo sign and send psbts', psbt.data.inputs)
  psbt.signInput(0, signer);
  psbt.signInput(1, signer);
  psbt.finalizeAllInputs()
  const tx = psbt.extractTransaction();
  console.log("🚀 ~ tx:", tx)
  
  const txid = await broadcast(tx.toHex());
  console.log("🚀 ~ txid:", txid)
  return txid
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
        console.log(data);
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