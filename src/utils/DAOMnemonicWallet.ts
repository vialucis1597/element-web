import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "bip39";
// @ts-ignore
const HDKey = require("hdkey");
import { keccak256 } from "js-sha3";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { EventType, type Room } from "matrix-js-sdk/src/matrix";
import SpaceStore from "../stores/spaces/SpaceStore";

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

    async createDAOWallet(daoId: string, daoName: string, currency: string = "B", contributionValue: number = 1): Promise<DAOWalletData> {
        const mnemonic = this.generateNewMnemonic();
        return await this.createDAOWalletFromMnemonic(daoId, daoName, currency, contributionValue, mnemonic);
    }

    async createDAOWalletFromMnemonic(
        daoId: string, 
        daoName: string, 
        currency: string, 
        contributionValue: number, 
        mnemonic: string
    ): Promise<DAOWalletData> {
        if (!validateMnemonic(mnemonic)) {
            throw new Error("Invalid mnemonic phrase");
        }

        const seed = mnemonicToSeedSync(mnemonic);
        const hdkey = HDKey.fromMasterSeed(seed);
        const wallet = hdkey.derive("m/44'/60'/0'/0/0");
        
        const publicKey = wallet.publicKey;
        const address = "0x" + keccak256(publicKey.slice(1)).slice(-40);
        
        // 원장에서 잔액 복구 시도
        const recoveredBalance = await this.recoverBalanceFromLedger(daoId, address);
        
        const daoWallet: DAOWalletData = {
            daoId,
            daoName,
            mnemonic,
            address,
            privateKey: wallet.privateKey!.toString('hex'),
            currency,
            balance: recoveredBalance,
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

    updateDAOWalletBalance(daoId: string, newBalance: number): boolean {
        console.log(`🎯 updateDAOWalletBalance called for ${daoId} with balance: ${newBalance}`);
        const wallet = this.daoWallets.get(daoId);
        if (!wallet) {
            console.error(`❌ No wallet found for daoId: ${daoId}`);
            return false;
        }

        const oldBalance = wallet.balance;
        wallet.balance = newBalance;
        
        console.log(`💰 Balance updated for ${wallet.daoName}: ${oldBalance} → ${newBalance} ${wallet.currency}`);
        
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

    notifyListeners(): void {
        const summaries = this.getAllDAOWallets();
        console.log(`🔔 DAOMnemonicWallet: Notifying ${this.listeners.length} listeners with:`, summaries);
        this.listeners.forEach((listener, index) => {
            try {
                console.log(`📡 DAOMnemonicWallet: Calling listener ${index + 1}`);
                listener(summaries);
            } catch (error) {
                console.error(`❌ DAOMnemonicWallet: Listener ${index + 1} failed:`, error);
            }
        });
        console.log(`✅ DAOMnemonicWallet: All listeners notified`);
    }

    async refreshDAOWalletBalance(daoId: string): Promise<boolean> {
        const wallet = this.daoWallets.get(daoId);
        if (!wallet) return false;

        try {
            console.log(`🔄 Refreshing balance for ${wallet.daoName} from ledger`);
            const refreshedBalance = await this.recoverBalanceFromLedger(daoId, wallet.address);
            
            if (refreshedBalance !== wallet.balance) {
                console.log(`💰 Balance updated: ${wallet.balance}B → ${refreshedBalance}B`);
                wallet.balance = refreshedBalance;
                this.saveWalletsToStorage();
                this.notifyListeners();
                return true;
            }
            
            console.log(`💰 Balance unchanged: ${wallet.balance}B`);
            return false;
        } catch (error) {
            console.error(`Failed to refresh balance for ${wallet.daoName}:`, error);
            return false;
        }
    }

    clearAllWallets(): void {
        this.daoWallets.clear();
        localStorage.removeItem('dao_individual_wallets');
        this.notifyListeners();
    }

    getTotalBalance(): number {
        return Array.from(this.daoWallets.values()).reduce((total, wallet) => total + wallet.balance, 0);
    }

    // 프로토콜상 존재하는 모든 DAO에 대한 잔액 조회 (클라이언트에 없는 DAO 포함)
    async getAllProtocolDAOBalances(): Promise<DAOWalletSummary[]> {
        try {
            console.log("🔍 Starting getAllProtocolDAOBalances...");
            const client = MatrixClientPeg.safeGet();
            const allSpaces = client.getRooms().filter(room => 
                room.isSpaceRoom() && 
                room.name && 
                room.roomId.startsWith('!')
            );

            console.log(`🌐 Found ${allSpaces.length} spaces:`, allSpaces.map(s => s.name));

            const balances: DAOWalletSummary[] = [];
            
            // 이미 생성된 지갑이 있다면 그 주소를 사용
            const existingWallets = this.getAllDAOWallets();
            if (existingWallets.length === 0) {
                console.log("❌ No existing wallets found");
                return []; // 지갑이 없으면 빈 배열 반환
            }

            const mainWalletAddress = existingWallets[0].address;
            console.log(`💰 Using wallet address: ${mainWalletAddress}`);

            for (const space of allSpaces) {
                try {
                    console.log(`🔍 Checking balance for DAO: ${space.name} (${space.roomId})`);
                    const balance = await this.recoverBalanceFromLedger(space.roomId, mainWalletAddress);
                    console.log(`💰 Balance for ${space.name}: ${balance}B`);
                    
                    if (balance > 0) { // 잔액이 있는 DAO만 추가
                        balances.push({
                            daoId: space.roomId,
                            daoName: space.name,
                            address: mainWalletAddress,
                            currency: "B",
                            balance: balance,
                            contributionValue: 1
                        });
                        console.log(`✅ Added ${space.name} with ${balance}B to balance list`);
                    } else {
                        console.log(`⏭️ Skipping ${space.name} (0 balance)`);
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to check balance for DAO ${space.name}:`, error);
                }
            }

            console.log(`📊 Final balances found: ${balances.length}`, balances);
            return balances.sort((a, b) => b.balance - a.balance); // 잔액 많은 순으로 정렬
        } catch (error) {
            console.error("❌ Error getting all protocol DAO balances:", error);
            return this.getAllDAOWallets(); // 실패시 기존 지갑만 반환
        }
    }

    // 원장에서 지갑 주소의 최신 잔액 복구
    private async recoverBalanceFromLedger(daoId: string, walletAddress: string): Promise<number> {
        try {
            const ledgerRoom = this.findLedgerRoom(daoId);
            if (!ledgerRoom) {
                console.log(`💰 No ledger room found for DAO ${daoId}, starting with balance 0`);
                return 0;
            }

            console.log(`🔍 Starting balance recovery for ${walletAddress} in DAO ${daoId}`);
            
            // 전체 룸 히스토리를 로드하기 위해 페이지네이션 사용
            const client = MatrixClientPeg.safeGet();
            const timeline = ledgerRoom.getLiveTimeline();
            
            // 먼저 현재 로드된 이벤트에서 검색
            let allEvents = timeline.getEvents();
            console.log(`📝 Currently loaded events: ${allEvents.length}`);
            
            // 과거 이벤트들을 더 로드 (최대 500개 이벤트까지 로드)
            let loadedMore = true;
            let loadAttempts = 0;
            const maxAttempts = 10; // 최대 10번 시도 (보통 50개씩 로드)
            
            while (loadedMore && loadAttempts < maxAttempts) {
                try {
                    const paginationToken = timeline.getPaginationToken("b"); // backward
                    if (!paginationToken) {
                        console.log("📝 No more events to load (no pagination token)");
                        break;
                    }
                    
                    console.log(`📝 Loading more events... (attempt ${loadAttempts + 1})`);
                    await client.paginateEventTimeline(timeline, { backwards: true, limit: 50 });
                    
                    const newEventCount = timeline.getEvents().length;
                    if (newEventCount === allEvents.length) {
                        console.log("📝 No new events loaded");
                        loadedMore = false;
                    } else {
                        allEvents = timeline.getEvents();
                        console.log(`📝 Loaded more events, total: ${newEventCount}`);
                    }
                    
                    loadAttempts++;
                } catch (paginationError) {
                    console.warn("⚠️ Failed to load more events:", paginationError);
                    break;
                }
            }
            
            console.log(`📝 Final event count for analysis: ${allEvents.length}`);
            
            // 최신부터 검색 (reverse)
            const eventsReversed = [...allEvents].reverse();
            
            for (const event of eventsReversed) {
                if (event.getType() === EventType.RoomMessage) {
                    const content = event.getContent();
                    const transactionData = content.transaction_data;
                    
                    if (transactionData) {
                        // Check if this wallet address is involved in the transaction
                        if (transactionData.to === walletAddress) {
                            // This wallet received money - use recipientBalance if available
                            if (typeof transactionData.recipientBalance === 'number') {
                                console.log(`💰 Found latest recipient balance for ${walletAddress}: ${transactionData.recipientBalance}B`);
                                console.log(`📅 Transaction timestamp: ${new Date(transactionData.timestamp).toISOString()}`);
                                return transactionData.recipientBalance;
                            } else if (typeof transactionData.balance === 'number') {
                                // Fallback to legacy balance field
                                console.log(`💰 Found latest balance (legacy) for ${walletAddress}: ${transactionData.balance}B`);
                                console.log(`📅 Transaction timestamp: ${new Date(transactionData.timestamp).toISOString()}`);
                                return transactionData.balance;
                            }
                        } else if (transactionData.from === walletAddress) {
                            // This wallet sent money - use senderBalance if available
                            if (typeof transactionData.senderBalance === 'number') {
                                console.log(`💰 Found latest sender balance for ${walletAddress}: ${transactionData.senderBalance}B`);
                                console.log(`📅 Transaction timestamp: ${new Date(transactionData.timestamp).toISOString()}`);
                                return transactionData.senderBalance;
                            } else if (typeof transactionData.balance === 'number') {
                                // Fallback to legacy balance field
                                console.log(`💰 Found latest balance (legacy) for ${walletAddress}: ${transactionData.balance}B`);
                                console.log(`📅 Transaction timestamp: ${new Date(transactionData.timestamp).toISOString()}`);
                                return transactionData.balance;
                            }
                        }
                    }
                }
            }
            
            console.log(`💰 No transaction history found for ${walletAddress} after checking ${allEvents.length} events`);
            return 0;
        } catch (error) {
            console.error("Error recovering balance from ledger:", error);
            return 0;
        }
    }

    // DAO의 원장 룸 찾기
    public findLedgerRoom(daoId: string): Room | null {
        try {
            const client = MatrixClientPeg.safeGet();
            const daoSpace = client.getRoom(daoId);
            if (!daoSpace) return null;

            const children = SpaceStore.instance.getChildren(daoId);
            for (const child of children) {
                const room = client.getRoom(child.roomId);
                if (room && !room.isSpaceRoom() && room.name === "ledger") {
                    return room;
                }
            }
            return null;
        } catch (error) {
            console.error("Error finding ledger room:", error);
            return null;
        }
    }
}

export default DAOMnemonicWallet;
