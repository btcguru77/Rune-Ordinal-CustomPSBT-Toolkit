import {
  Transaction,
  script,
  Psbt,
  address as Address,
  initEccLib,
  networks,
  Signer as BTCSigner,
  crypto,
  payments,
} from "bitcoinjs-lib";
import { Taptree } from "bitcoinjs-lib/src/types";
import { ECPairFactory, ECPairAPI } from "ecpair";
import ecc from "@bitcoinerlab/secp256k1";
import axios, { AxiosResponse } from "axios";
import {
  Rune,
  RuneId,
  Runestone,
  EtchInscription,
  none,
  some,
  Terms,
  Range,
  Etching,
} from "runelib";
import networkConfig from "config/network.config";

import { SeedWallet } from "utils/SeedWallet";
import { WIFWallet } from 'utils/WIFWallet'
import { getCurrentFeeRate, getUtxos } from "utils/mempool";
import { getFeeForSimplePsbt } from "Parent_Inscription";
import { sendUTXO } from "Custom_UTXO";

initEccLib(ecc as any);
declare const window: any;
const ECPair: ECPairAPI = ECPairFactory(ecc);
const network = networks.testnet;
const networkType: string = networkConfig.networkType;

// const seed: string = process.env.MNEMONIC as string;
// const wallet = new SeedWallet({ networkType: networkType, seed: seed });

const privateKey: string = process.env.PRIVATE_KEY as string;
const wallet = new WIFWallet({ networkType: networkType, privateKey: privateKey });

// Temp txid
const tempTxid = "9cf36d8d8db735417828b315499696f113eb44a6ad0cfce045bb65f8e3760b5e";

const tempUtxo = {
  txid: tempTxid,
  vout: 0,
  value: 546
}

async function etching() {

  const name = "RUNEETCHINGSCRIPT";

  const keyPair = wallet.ecPair;

  const ins = new EtchInscription()

  ins.setContent("text/plain", Buffer.from('rune etching script', 'utf-8'))
  ins.setRune(name)

  const etching_script_asm = `${toXOnly(keyPair.publicKey).toString(
    "hex"
  )} OP_CHECKSIG`;
  const etching_script = Buffer.concat([script.fromASM(etching_script_asm), ins.encipher()]);

  const scriptTree: Taptree = {
    output: etching_script,
  }

  const script_p2tr = payments.p2tr({
    internalPubkey: toXOnly(keyPair.publicKey),
    scriptTree,
    network,
  });

  const etching_redeem = {
    output: etching_script,
    redeemVersion: 192
  }


  const etching_p2tr = payments.p2tr({
    internalPubkey: toXOnly(keyPair.publicKey),
    scriptTree,
    redeem: etching_redeem,
    network
  });


  const address = script_p2tr.address ?? "";
  console.log("send coin to address", address);

  const rune = Rune.fromName(name)

  const amount = 1000;
  const cap = 21000;
  const terms = new Terms(amount, cap, new Range(none(), none()), new Range(none(), none()))
  const symbol = "$"
  const premine = some(1000);
  const divisibility = none();
  const etching = new Etching(divisibility, premine, some(rune), none(), some(symbol), some(terms), true);

  const stone = new Runestone([], some(etching), none(), none());

  const currentFeeRate = await getCurrentFeeRate();
  const virtualSize = await getVirtulByte(etching_redeem, script_p2tr, etching_p2tr, stone);
  console.log("🚀 ~ etching ~ virtualSize:", virtualSize)
  const allUtxos = await getUtxos(wallet.address, networkType);
  const simplePsbt = await getFeeForSimplePsbt(allUtxos[0])
  if (!virtualSize || !simplePsbt) return console.log("Invaid psbt")

  console.log("needed fee => ", currentFeeRate * virtualSize)

  await sendUTXO(currentFeeRate, currentFeeRate * virtualSize + 546, address);

  console.log("send coin to address", address);

  setTimeout(async () => {
    const utxos = await waitUntilUTXO(address as string);
    console.log(`Using UTXO ${utxos}`);
  
    const psbt = new Psbt({ network });
  
    psbt.addInput({
      hash: utxos[utxos.length - 1].txid,
      index: utxos[utxos.length - 1].vout,
      witnessUtxo: { value: utxos[utxos.length - 1].value, script: etching_p2tr.output! },
      tapLeafScript: [
        {
          leafVersion: etching_redeem.redeemVersion,
          script: etching_redeem.output,
          controlBlock: etching_p2tr.witness![etching_p2tr.witness!.length - 1],
        },
      ],
    });
  
    psbt.addOutput({
      script: stone.encipher(),
      value: 0,
    });
  
    psbt.addOutput({
      address: "tb1p5yjm3fkr6n4rumfjm5c5rsu7c9uc4av847p0cu2n8vfdv05pph9smdjrt3", // change address
      value: 546,
    });
  
    await signAndSend(keyPair, psbt, address as string);
    
  }, 1000 * 60 * 60);

}

// main
etching();


export const getVirtulByte = async (redeem: any, script_p2tr: any, etching_p2tr: any, stone: any) => {

  let psbt = new Psbt({ network });

  psbt.addInput({
    hash: tempUtxo.txid,
    index: tempUtxo.vout,
    witnessUtxo: { value: tempUtxo.value, script: script_p2tr.output! },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: etching_p2tr.witness![etching_p2tr.witness!.length - 1],
      },
    ],
  });



  psbt.addOutput({
    script: stone.encipher(),
    value: 0,
  });

  const change = tempUtxo.value - 546;

  psbt.addOutput({
    address: "tb1p5yjm3fkr6n4rumfjm5c5rsu7c9uc4av847p0cu2n8vfdv05pph9smdjrt3", // change address
    value: 546,
  });

  psbt.addOutput({
    address: wallet.address, // change address
    value: change,
  });

  try {
    psbt = wallet.signSpecPsbt(psbt, wallet.ecPair)
    return psbt.extractTransaction().virtualSize();
  } catch (error) {
    console.log("getting virtualsize error => ", error)
    return 0;
  }
}

const blockstream = new axios.Axios({
  baseURL: `https://mempool.space/testnet/api`,
});

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
    intervalId = setInterval(checkForUtxo, 5000);
  });
}

export async function getTx(id: string): Promise<string> {
  const response: AxiosResponse<string> = await blockstream.get(
    `/tx/${id}/hex`
  );
  return response.data;
}

export async function signAndSend(
  keyPair: BTCSigner,
  psbt: Psbt,
  address: string
) {
  if (process.env.NODE) {
    psbt.signInput(0, keyPair);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    console.log(`Broadcasting Transaction Hex: ${tx.toHex()}`);
    console.log(tx.virtualSize())
    const txid = await broadcast(tx.toHex());
    console.log(`Success! Txid is ${txid}`);
  } else {
    // in browser

    try {
      let res = await window.unisat.signPsbt(psbt.toHex(), {
        toSignInputs: [
          {
            index: 0,
            address: address,
          },
        ],
      });

      console.log("signed psbt", res);

      res = await window.unisat.pushPsbt(res);

      console.log("txid", res);
    } catch (e) {
      console.log(e);
    }
  }
}

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

function tweakSigner(signer: BTCSigner, opts: any = {}): BTCSigner {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  let privateKey: Uint8Array | undefined = signer.privateKey!;
  if (!privateKey) {
    throw new Error("Private key is required for tweaking signer!");
  }
  if (signer.publicKey[0] === 3) {
    privateKey = ecc.privateNegate(privateKey);
  }

  const tweakedPrivateKey = ecc.privateAdd(
    privateKey,
    tapTweakHash(toXOnly(signer.publicKey), opts.tweakHash)
  );
  if (!tweakedPrivateKey) {
    throw new Error("Invalid tweaked private key!");
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
