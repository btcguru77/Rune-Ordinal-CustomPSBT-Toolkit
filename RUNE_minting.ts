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
import { ECPairFactory, ECPairAPI } from "ecpair";
import ecc from "@bitcoinerlab/secp256k1";
import axios, { AxiosResponse } from "axios";
import { Rune, RuneId, Runestone, EtchInscription, none, some, Terms, Range, Etching } from "runelib";
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

const privateKey: string = process.env.PRIVATE_KEY as string;
const wallet = new WIFWallet({ networkType: networkType, privateKey: privateKey });

// const seed: string = process.env.MNEMONIC as string;
// const wallet = new SeedWallet({ networkType: networkType, seed: seed });

async function mintWithTaproot() {

    const keyPair = wallet.ecPair;
    const mintstone = new Runestone([], none(), some(new RuneId(2869719, 2706)), some(1));

    const tweakedSigner = tweakSigner(keyPair, { network });
    // Generate an address from the tweaked public key
    const p2pktr = payments.p2tr({
        pubkey: toXOnly(tweakedSigner.publicKey),
        network
    });
    const address = p2pktr.address ?? "";
    console.log(`Waiting till UTXO is detected at this Address: ${address}`);


    const currentFeeRate = await getCurrentFeeRate();
    const virtualSize = await getVirtulByte(p2pktr, mintstone);
    if (!virtualSize) return console.log("Invaid psbt")


    const feeTxid = await sendUTXO(currentFeeRate, currentFeeRate * virtualSize + 546, address);
    console.log("🚀 ~ mintWithTaproot ~ feeTxid:", feeTxid)

    const utxos = await waitUntilUTXO(address as string);
    console.log("🚀 ~ mintWithTaproot ~ utxos:", utxos)

    // console.log(`Using UTXO ${utxos[0].txid}:${utxos[0].vout}`);

    const psbt = new Psbt({ network });
    psbt.addInput({
        hash: utxos[utxos.length - 1].txid,
        index: utxos[utxos.length - 1].vout,
        witnessUtxo: { value: utxos[utxos.length - 1].value, script: p2pktr.output! },
        tapInternalKey: toXOnly(keyPair.publicKey)
    });

    psbt.addOutput({
        script: mintstone.encipher(),
        value: 0
    });

    psbt.addOutput({
        address: 'tb1pntrn45rwhrfv7dlqjjkw6keg7hex2zc598sekzdda3yzxfjstpfs4y8qcx', // rune receive address
        value: 546
    });

    psbt.addOutput({
        address: wallet.address, // rune receive address
        value: utxos[utxos.length - 1].value - (currentFeeRate * virtualSize + 546)
    })

    await signAndSend(tweakedSigner, psbt, address as string);

}

// main
mintWithTaproot();


// Temp txid
const tempTxid = "9cf36d8d8db735417828b315499696f113eb44a6ad0cfce045bb65f8e3760b5e";

const tempUtxo = {
    txid: tempTxid,
    vout: 0,
    value: 2000
}

export const getVirtulByte = async (p2pktr: any, mintstone: any) => {

    let psbt = new Psbt({ network });
    psbt.addInput({
        hash: tempUtxo.txid,
        index: tempUtxo.vout,
        witnessUtxo: { value: tempUtxo.value, script: p2pktr.output! },
        tapInternalKey: toXOnly(wallet.ecPair.publicKey)
    });

    psbt.addOutput({
        script: mintstone.encipher(),
        value: 0
    });

    psbt.addOutput({
        address: wallet.address, // rune receive address
        value: 546
    });

    psbt.addOutput({
        address: wallet.address, // rune receive address
        value: 546
    });

    try {
        psbt = wallet.signPsbt(psbt, wallet.ecPair)
        return psbt.extractTransaction().virtualSize();
    } catch (error) {
        console.log("getting virtualsize error => ", error)
        return 0;
    }
}


const blockstream = new axios.Axios({
    baseURL: `https://mempool.space/testnet/api`
});

export async function waitUntilUTXO(address: string) {
    return new Promise<IUTXO[]>((resolve, reject) => {
        let intervalId: any;
        const checkForUtxo = async () => {
            try {
                const response: AxiosResponse<string> = await blockstream.get(`/address/${address}/utxo`);
                const data: IUTXO[] = response.data ? JSON.parse(response.data) : undefined;
                if (data.length > 0) {
                    resolve(data);
                    clearInterval(intervalId);
                }
            } catch (error) {
                reject(error);
                clearInterval(intervalId);
            }
        };
        intervalId = setInterval(checkForUtxo, 3000);
    });
}

export async function getTx(id: string): Promise<string> {
    const response: AxiosResponse<string> = await blockstream.get(`/tx/${id}/hex`);
    return response.data;
}

export async function signAndSend(keyPair: BTCSigner, psbt: Psbt, address: string) {
    if (process.env.NODE) {

        psbt.signInput(0, keyPair);
        psbt.finalizeAllInputs();

        const tx = psbt.extractTransaction();
        console.log(tx.virtualSize())
        console.log(`Broadcasting Transaction Hex: ${tx.toHex()}`);
        const txid = await broadcast(tx.toHex());
        console.log(`Success! Txid is ${txid}`);

    } else { // in browser

        try {
            let res = await window.unisat.signPsbt(psbt.toHex(), {
                toSignInputs: [
                    {
                        index: 0,
                        address: address,
                    }
                ]
            });

            console.log("signed psbt", res)

            res = await window.unisat.pushPsbt(res);

            console.log("txid", res)
        } catch (e) {
            console.log(e);
        }
    }

}

export async function broadcast(txHex: string) {
    const response: AxiosResponse<string> = await blockstream.post('/tx', txHex);
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
