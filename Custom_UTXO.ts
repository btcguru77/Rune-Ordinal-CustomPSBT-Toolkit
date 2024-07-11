import networkConfig from "config/network.config";
import { getUtxos, pushBTCpmt } from "./utils/mempool";
import * as Bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import dotenv from "dotenv";
import { WIFWallet } from "utils/WIFWallet";
// import { WIFWallet } from 'utils/WIFWallet'

const RECEIVEADDRESS = 'tb1p0ec0c2zjg98q6fcuyrk0tg8xvzaj6ksdndak3ck4wfsr6vufu9ss3z83l4';

dotenv.config();
Bitcoin.initEccLib(ecc);

const networkType: string = networkConfig.networkType;
// const seed: string = process.env.MNEMONIC as string;
const privateKey: string = process.env.PRIVATE_KEY as string;

interface IUtxo {
    txid: string;
    vout: number;
    value: number;
}

const getMinimalUtxos = async (UTXOs: IUtxo[], totalBTC: number) => {
    // Sort the array in descending order
    UTXOs.sort((a, b) => b.value - a.value);

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

const getPSBT = (wallet: any, utxos: IUtxo[], fee: number, networkType: string, addr: string, amount: number): Bitcoin.Psbt => {
    const psbt = new Bitcoin.Psbt({
        network: networkType == "testnet" ? Bitcoin.networks.testnet : Bitcoin.networks.bitcoin
    });

    let totalBTC = 0;

    for (let i = 0; i < utxos.length; i++) {
        const utxo = utxos[i];
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                value: utxo.value,
                script: wallet.output,
            },
            tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
        });
        totalBTC += utxo.value;
    }
    psbt.addOutput({
        address: addr,
        value: amount,
    });
    psbt.addOutput({
        address: wallet.address,
        value: totalBTC - amount - fee
    })
    return psbt;
}

export const sendUTXO = async (feerate: number, amount: number, address: string) => {
    console.log("sending fee")
    // const wallet = new SeedWallet({ networkType: networkType, seed: seed });
    const wallet = new WIFWallet({ networkType: networkType, privateKey: privateKey });
    const utxos = await getUtxos(wallet.address, networkType);

    if (utxos.length === 0) {
        return console.log("No utxo!")
    }

    // Test psbt with 1000 fee
    const miniMalUTXOs = await getMinimalUtxos(utxos, amount + 1000);
    if (miniMalUTXOs.result.length === 0) return console.log("You don't have enough balance!");

    console.log("miniMalUTXOs => ", miniMalUTXOs.result)

    let testfee = 1000;
    let tmpPsbtByte = 0;
    let txId;
    let ready = false;
    while (!ready) {
        let psbt = getPSBT(wallet, miniMalUTXOs.result, testfee, networkType, wallet.address, amount);
        psbt = wallet.signPsbt(psbt, wallet.ecPair);
        let psbtByte = psbt.extractTransaction().virtualSize();
        if (tmpPsbtByte === psbtByte) {
            ready = true;
            break;
        } else {
            tmpPsbtByte = psbtByte;
            testfee = psbtByte * feerate;
        }
    }

    try {
        let psbt = getPSBT(wallet, miniMalUTXOs.result, testfee, networkType, address, amount);
        psbt = wallet.signPsbt(psbt, wallet.ecPair);
        const txHex = psbt.extractTransaction().toHex();
        txId = await pushBTCpmt(txHex, networkType);

        return txId
    } catch (error) {
        console.log("Pushing txid error => ", error);
        return error
    }
}

// send all assets
const sendFullBTC = async (feerate: number, amount: number, address: string) => {
    // const wallet = new SeedWallet({ networkType: networkType, seed: seed });
    const wallet = new WIFWallet({ networkType: networkType, privateKey: privateKey });
    const utxos = await getUtxos(wallet.address, networkType);

    if (utxos.length === 0) {
        return console.log("No utxo!")
    }

    let testfee = 1000;
    let tmpPsbtByte = 0;
    let txId;
    let ready = false;
    while (!ready) {
        let psbt = getPSBT(wallet, utxos, testfee, networkType, wallet.address, amount);
        psbt = wallet.signPsbt(psbt, wallet.ecPair);
        let psbtByte = psbt.extractTransaction().virtualSize();
        if (tmpPsbtByte === psbtByte) {
            ready = true;
            break;
        } else {
            tmpPsbtByte = psbtByte;
            testfee = psbtByte * feerate;
        }
    }



    console.log("test tmpPsbtByte => ", tmpPsbtByte * feerate)

    try {
        let psbt = getPSBT(wallet, utxos, testfee, networkType, address, amount);
        psbt = wallet.signPsbt(psbt, wallet.ecPair);
        const txHex = psbt.extractTransaction().toHex();
        txId = await pushBTCpmt(txHex, networkType);

        console.log(`Send_UTXO_TxId=======> ${txId}`)
    } catch (error) {
        console.log("Pushing txid error => ", error);
    }

}