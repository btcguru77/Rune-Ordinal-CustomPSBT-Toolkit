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
import { getCurrentFeeRate } from "utils/mempool";
import { sendUTXO } from "Custom_UTXO";
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

const txhash: string = 'af890083d09cbee3cbb455ebf2894767362f6f0a34ca12a0355c205e3f5eb923';
const txidBuffer = Buffer.from(txhash, 'hex');
const delegateBuffer = txidBuffer.reverse();

const receiveAddress: string = "tb1pvqmx008fhtrw7vdpqpeuupwvgq0k74n9fuvc2st7ex26ctcd4spqwxcu7e";

const tempTxid = "9cf36d8d8db735417828b315499696f113eb44a6ad0cfce045bb65f8e3760b5e";

const tempUtxo = {
  txid: tempTxid,
  vout: 0,
  value: 546
}


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

export function createdelegateInscriptionTapScript(): Array<Buffer> {

  const keyPair = wallet.ecPair;
  const delegateOrdinalStacks: any = [
    toXOnly(keyPair.publicKey),
    opcodes.OP_CHECKSIG,
    opcodes.OP_FALSE,
    opcodes.OP_IF,
    Buffer.from("ord", "utf8"),
    1,
    11,
    delegateBuffer,
    opcodes.OP_ENDIF,
  ];
  return delegateOrdinalStacks;
}

async function delegateInscribe() {
  const keyPair = wallet.ecPair;
  const delegateOrdinalStack = createdelegateInscriptionTapScript();

  const ordinal_script = script.compile(delegateOrdinalStack);

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

  const currentFee = await getCurrentFeeRate();
  const virtualSize = await getVirtulByte(redeem, ordinal_p2tr);

  await sendUTXO(currentFee, currentFee * virtualSize + 546, address);

  const utxos = await waitUntilUTXO(address as string);
  console.log(`Using UTXO ${utxos[0].txid}:${utxos[0].vout}`);

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

delegateInscribe()

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