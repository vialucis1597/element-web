import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "bip39";
// @ts-ignore
const HDKey = require("hdkey");
import { keccak256 } from "js-sha3";

export interface DAOWalletData {
    daoId: string;
    daoName: string;
    mnemonic: string;
    address: string;
    privateKey: string;
    currency: string;
    balance: number;
    contributionValue: number;
    createdAt: string;
}

export interface DAOWalletSummary {
    daoId: string;
    daoName: string;
    address: string;
    currency: string;
    balance: number;
    contributionValue: number;
}

export class DAOMnemonicWallet {
    private static instance: DAOMnemonicWallet;
    private daoWallets: Map<string, DAOWalletData> = new Map();
    private listeners: ((wallets: DAOWalletSummary[]) => void)[] = [];

    static getInstance(): DAOMnemonicWallet {
        if (!DAOMnemonicWallet.instance) {
            DAOMnemonicWallet.instance = new DAOMnemonicWallet();
        }
        return DAOMnemonicWallet.instance;
    }

    constructor() {
        this.loadWalletsFromStorage();
    }

    generateNewMnemonic(): string {
        return generateMnemonic(128); // 12 words
    }

    createDAOWallet(daoId: string, daoName: string, currency: string = "B", contributionValue: number = 1): DAOWalletData {
        const mnemonic = this.generateNewMnemonic();
        return this.createDAOWalletFromMnemonic(daoId, daoName, currency, contributionValue, mnemonic);
    }

    createDAOWalletFromMnemonic(
        daoId: string, 
        daoName: string, 
        currency: string, 
        contributionValue: number, 
        mnemonic: string
    ): DAOWalletData {
        if (!validateMnemonic(mnemonic)) {
            throw new Error("Invalid mnemonic phrase");
        }

        const seed = mnemonicToSeedSync(mnemonic);
        const hdkey = HDKey.fromMasterSeed(seed);
        const wallet = hdkey.derive("m/44'/60'/0'/0/0");
        
        const publicKey = wallet.publicKey;
        const address = "0x" + keccak256(publicKey.slice(1)).slice(-40);
        
        const daoWallet: DAOWalletData = {
            daoId,
            daoName,
            mnemonic,
            address,
            privateKey: wallet.privateKey!.toString('hex'),
            currency,
            balance: 0,
            contributionValue,
            createdAt: new Date().toISOString()
        };

        this.daoWallets.set(daoId, daoWallet);
        this.saveWalletsToStorage();
        this.notifyListeners();

        return daoWallet;
    }

    getDAOWallet(daoId: string): DAOWalletData | null {
        return this.daoWallets.get(daoId) || null;
    }

    getAllDAOWallets(): DAOWalletSummary[] {
        return Array.from(this.daoWallets.values()).map(wallet => ({
            daoId: wallet.daoId,
            daoName: wallet.daoName,
            address: wallet.address,
            currency: wallet.currency,
            balance: wallet.balance,
            contributionValue: wallet.contributionValue
        }));
    }

    hasDAOWallet(daoId: string): boolean {
        return this.daoWallets.has(daoId);
    }

    updateDAOCurrency(daoId: string, currency: string, contributionValue: number): boolean {
        const wallet = this.daoWallets.get(daoId);
        if (!wallet) return false;

        wallet.currency = currency;
        wallet.contributionValue = contributionValue;
        
        this.saveWalletsToStorage();
        this.notifyListeners();
        return true;
    }

    awardContribution(daoId: string, multiplier: number = 1): boolean {
        const wallet = this.daoWallets.get(daoId);
        if (!wallet) return false;

        const awardAmount = wallet.contributionValue * multiplier;
        wallet.balance += awardAmount;

        this.saveWalletsToStorage();
        this.notifyListeners();

        console.log(`Awarded ${awardAmount} ${wallet.currency} to DAO wallet ${wallet.daoName}`);
        return true;
    }

    getDAOWalletMnemonic(daoId: string): string | null {
        const wallet = this.daoWallets.get(daoId);
        return wallet?.mnemonic || null;
    }

    signData(daoId: string, data: string): string | null {
        const wallet = this.daoWallets.get(daoId);
        if (!wallet) return null;

        try {
            const privateKey = Buffer.from(wallet.privateKey, 'hex');
            const combinedData = data + wallet.privateKey + wallet.address;
            const signature = keccak256(combinedData);
            
            console.log(`🔐 Generated signature for DAO ${wallet.daoName}:`, data.substring(0, 50) + "...");
            return signature;
        } catch (error) {
            console.error("Failed to sign data:", error);
            return null;
        }
    }

    verifySignature(daoId: string, data: string, signature: string): boolean {
        const wallet = this.daoWallets.get(daoId);
        if (!wallet) return false;

        try {
            const combinedData = data + wallet.privateKey + wallet.address;
            const expectedSignature = keccak256(combinedData);
            return signature === expectedSignature;
        } catch (error) {
            console.error("Failed to verify signature:", error);
            return false;
        }
    }

    deleteDAOWallet(daoId: string): boolean {
        const deleted = this.daoWallets.delete(daoId);
        if (deleted) {
            this.saveWalletsToStorage();
            this.notifyListeners();
        }
        return deleted;
    }

    exportDAOWallet(daoId: string): string {
        const wallet = this.daoWallets.get(daoId);
        if (!wallet) throw new Error("DAO wallet not found");
        
        return JSON.stringify({
            daoId: wallet.daoId,
            daoName: wallet.daoName,
            mnemonic: wallet.mnemonic,
            address: wallet.address,
            currency: wallet.currency,
            balance: wallet.balance,
            contributionValue: wallet.contributionValue,
            createdAt: wallet.createdAt,
            exportedAt: new Date().toISOString()
        }, null, 2);
    }

    restoreDAOWalletFromBackup(backupData: string): DAOWalletData {
        const data = JSON.parse(backupData);
        
        if (!data.daoId || !data.mnemonic) {
            throw new Error("Invalid backup data");
        }

        return this.createDAOWalletFromMnemonic(
            data.daoId,
            data.daoName || "Restored DAO",
            data.currency || "DAOToken",
            data.contributionValue || 1,
            data.mnemonic
        );
    }

    validateMnemonicPhrase(mnemonic: string): boolean {
        return validateMnemonic(mnemonic);
    }

    private saveWalletsToStorage(): void {
        const walletsArray = Array.from(this.daoWallets.values());
        localStorage.setItem('dao_individual_wallets', JSON.stringify(walletsArray));
    }

    private loadWalletsFromStorage(): void {
        try {
            const stored = localStorage.getItem('dao_individual_wallets');
            if (stored) {
                const walletsArray: DAOWalletData[] = JSON.parse(stored);
                this.daoWallets.clear();
                walletsArray.forEach(wallet => {
                    this.daoWallets.set(wallet.daoId, wallet);
                });
            }
        } catch (error) {
            console.error("Failed to load DAO wallets from storage:", error);
        }
    }

    addListener(callback: (wallets: DAOWalletSummary[]) => void): void {
        this.listeners.push(callback);
    }

    removeListener(callback: (wallets: DAOWalletSummary[]) => void): void {
        this.listeners = this.listeners.filter(listener => listener !== callback);
    }

    private notifyListeners(): void {
        const summaries = this.getAllDAOWallets();
        this.listeners.forEach(listener => listener(summaries));
    }

    clearAllWallets(): void {
        this.daoWallets.clear();
        localStorage.removeItem('dao_individual_wallets');
        this.notifyListeners();
    }

    getTotalBalance(): number {
        return Array.from(this.daoWallets.values()).reduce((total, wallet) => total + wallet.balance, 0);
    }
}

export default DAOMnemonicWallet;
